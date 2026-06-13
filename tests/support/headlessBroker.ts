import {
  AgentLifecycleManager,
  type AgentMessage,
  isRouteAllowed,
  normalizeAgentMessage,
  ReliableRequestManager,
  type ReliableRequestRecord,
  StarlightEnvelopeParser,
} from '../../src/services/brokerCore.ts';
import { BrokerStore } from '../../electron/brokerStore.ts';
import { PtyService, type PtySpawnOptions } from '../../electron/ptyService.ts';

export interface HeadlessBrokerOptions {
  databasePath: string;
  connections: Record<string, string[]>;
  acknowledgementTimeoutMs?: number;
  completionTimeoutMs?: number;
  retryBaseDelayMs?: number;
  maxAttempts?: number;
}

export class HeadlessBroker {
  readonly store: BrokerStore;
  readonly lifecycle: AgentLifecycleManager;
  readonly requests: ReliableRequestManager;
  readonly ptys: PtyService;
  readonly parseErrors: unknown[] = [];
  readonly responses: AgentMessage[] = [];
  private readonly parser = new StarlightEnvelopeParser();
  private readonly connections: Record<string, string[]>;
  private sequence = 0;
  private closed = false;

  constructor(options: HeadlessBrokerOptions) {
    this.connections = options.connections;
    this.store = new BrokerStore(options.databasePath);
    this.lifecycle = new AgentLifecycleManager((agent) => {
      this.store.upsertAgent(agent);
      if (agent.state === 'ready') this.requests?.wakeTarget(agent.agentId);
    });
    this.ptys = new PtyService({
      onData: (id, data) => this.onData(id, data),
      onExit: (id, exit) => {
        if (this.closed) return;
        this.requests.failTarget(id, `PTY exited with code ${exit.exitCode}.`);
        this.lifecycle.failed(id, `PTY exited with code ${exit.exitCode}.`);
      },
    });
    this.requests = new ReliableRequestManager(
      async (target, data) => this.ptys.write(target, data),
      (record) => this.persistRequest(record),
      undefined,
      {
        acknowledgementTimeoutMs: options.acknowledgementTimeoutMs,
        completionTimeoutMs: options.completionTimeoutMs,
        retryBaseDelayMs: options.retryBaseDelayMs,
        maxAttempts: options.maxAttempts,
      },
      Date.now,
      {
        canDeliver: (target, taskId) => this.lifecycle.canAcceptTask(target, taskId),
        onTaskStarted: (target, taskId) => this.lifecycle.taskStarted(target, taskId),
      }
    );
  }

  spawnAgent(options: PtySpawnOptions) {
    this.lifecycle.register(options.id);
    this.lifecycle.starting(options.id);
    return this.ptys.spawn(options);
  }

  submit(from: string, to: string, instruction: string): AgentMessage {
    if (!isRouteAllowed(this.connections, from, to)) {
      throw new Error(`Route ${from} -> ${to} is not allowed.`);
    }
    const now = Date.now();
    const message: AgentMessage = {
      protocolVersion: 1,
      messageId: `e2e-message-${++this.sequence}`,
      taskId: `e2e-task-${this.sequence}`,
      from,
      to,
      kind: 'request',
      payload: { instruction },
      attempt: 1,
      timestamp: now,
    };
    this.requests.submit(message);
    return message;
  }

  restartAgent(options: PtySpawnOptions) {
    if (this.ptys.has(options.id)) this.ptys.kill(options.id);
    return this.spawnAgent(options);
  }

  close() {
    this.closed = true;
    this.ptys.close();
    this.store.close();
  }

  private onData(sourceId: string, data: string) {
    if (this.closed) return;
    const parsed = this.parser.push(sourceId, data);
    this.parseErrors.push(...parsed.errors);
    for (const item of parsed.messages) {
      try {
        const message = normalizeAgentMessage(item.envelope, { sourceId });
        if (!isRouteAllowed(this.connections, message.from, message.to) && message.to !== 'broker') continue;
        this.responses.push(message);
        if (message.kind === 'ready') {
          this.lifecycle.ready(sourceId);
        } else if (message.kind === 'heartbeat') {
          this.lifecycle.heartbeat(sourceId);
        } else {
          const disposition = this.requests.handleResponse(message);
          if (disposition === 'accepted' && ['result', 'error', 'cancel'].includes(message.kind)) {
            this.lifecycle.taskFinished(sourceId, message.taskId);
            this.requests.wakeTarget(sourceId);
          }
        }
      } catch (error) {
        this.parseErrors.push(error);
      }
    }
  }

  private persistRequest(record: ReliableRequestRecord) {
    this.store.upsertMessage({
      ...record.message,
      status: record.status,
      attempt: record.attempt,
      error: record.error,
      deliveredAt: record.deliveredAt,
      acknowledgedAt: record.acknowledgedAt,
      completedAt: record.completedAt,
    });
  }
}
