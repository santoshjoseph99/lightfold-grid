export const STARLIGHT_START_TAG = '[[STARLIGHT-MSG]]';
export const STARLIGHT_END_TAG = '[[END]]';
export const AGENT_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_MESSAGE_HISTORY_LIMIT = 500;

export interface StarlightEnvelope {
  from?: string;
  to?: string;
  command?: string;
  type?: string;
}

export type AgentMessageKind =
  | 'request'
  | 'ack'
  | 'progress'
  | 'result'
  | 'error'
  | 'cancel'
  | 'ready'
  | 'heartbeat';

export interface AgentMessagePayload {
  instruction?: string;
  summary?: string;
  artifacts?: string[];
  data?: unknown;
}

export interface AgentMessage {
  protocolVersion: typeof AGENT_PROTOCOL_VERSION;
  messageId: string;
  taskId: string;
  parentTaskId?: string;
  correlationId?: string;
  from: string;
  to: string;
  kind: AgentMessageKind;
  payload: AgentMessagePayload;
  attempt: number;
  timestamp: number;
}

export interface ParsedEnvelope {
  sourceId: string;
  envelope: unknown;
}

export interface EnvelopeParseError {
  sourceId: string;
  payload: string;
  error: unknown;
}

const MAX_BUFFER_LENGTH = 1024 * 1024;
const MESSAGE_KINDS = new Set<AgentMessageKind>([
  'request',
  'ack',
  'progress',
  'result',
  'error',
  'cancel',
  'ready',
  'heartbeat',
]);

export class ProtocolValidationError extends Error {
  readonly code: string;

  constructor(
    message: string,
    code: string
  ) {
    super(message);
    this.name = 'ProtocolValidationError';
    this.code = code;
  }
}

export interface NormalizeMessageOptions {
  sourceId: string;
  createId?: () => string;
  now?: () => number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const optionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProtocolValidationError(`${field} must be a non-empty string.`, 'INVALID_FIELD');
  }
  return value.trim();
};

const requiredString = (value: unknown, field: string): string => {
  const result = optionalString(value, field);
  if (!result) {
    throw new ProtocolValidationError(`${field} is required.`, 'MISSING_FIELD');
  }
  return result;
};

const validatePayload = (value: unknown): AgentMessagePayload => {
  if (!isRecord(value)) {
    throw new ProtocolValidationError('payload must be an object.', 'INVALID_PAYLOAD');
  }

  const instruction = optionalString(value.instruction, 'payload.instruction');
  const summary = optionalString(value.summary, 'payload.summary');
  let artifacts: string[] | undefined;
  if (value.artifacts !== undefined) {
    if (!Array.isArray(value.artifacts) || value.artifacts.some((item) => typeof item !== 'string')) {
      throw new ProtocolValidationError('payload.artifacts must be an array of strings.', 'INVALID_PAYLOAD');
    }
    artifacts = [...value.artifacts];
  }

  return {
    instruction,
    summary,
    artifacts,
    data: value.data,
  };
};

const legacyKind = (type: unknown): AgentMessageKind => {
  if (typeof type !== 'string') return 'request';
  const normalized = type.toLowerCase();
  if (['result', 'finish', 'approve'].includes(normalized)) return 'result';
  if (['progress', 'logs', 'status'].includes(normalized)) return 'progress';
  if (['error', 'failure', 'chaos_fail'].includes(normalized)) return 'error';
  if (normalized === 'cancel') return 'cancel';
  if (normalized === 'ack') return 'ack';
  return 'request';
};

export const createProtocolId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export const normalizeAgentMessage = (
  value: unknown,
  options: NormalizeMessageOptions
): AgentMessage => {
  if (!isRecord(value)) {
    throw new ProtocolValidationError('Message envelope must contain a JSON object.', 'INVALID_ENVELOPE');
  }

  const createId = options.createId || createProtocolId;
  const now = options.now || Date.now;
  const messageId = createId();
  const timestamp = now();

  if (value.protocolVersion === undefined) {
    const command = requiredString(value.command, 'command');
    return {
      protocolVersion: AGENT_PROTOCOL_VERSION,
      messageId,
      taskId: createId(),
      from: options.sourceId,
      to: requiredString(value.to, 'to'),
      kind: legacyKind(value.type),
      payload: {
        instruction: command,
        data: {
          legacy: true,
          legacyType: typeof value.type === 'string' ? value.type : undefined,
        },
      },
      attempt: 1,
      timestamp,
    };
  }

  if (value.protocolVersion !== AGENT_PROTOCOL_VERSION) {
    throw new ProtocolValidationError(
      `Unsupported protocolVersion ${String(value.protocolVersion)}.`,
      'UNSUPPORTED_VERSION'
    );
  }

  if (typeof value.kind !== 'string' || !MESSAGE_KINDS.has(value.kind as AgentMessageKind)) {
    throw new ProtocolValidationError('kind is not supported.', 'INVALID_KIND');
  }
  const kind = value.kind as AgentMessageKind;
  const suppliedTaskId = optionalString(value.taskId, 'taskId');
  const isLifecycleMessage = kind === 'ready' || kind === 'heartbeat';
  if (!suppliedTaskId && kind !== 'request' && !isLifecycleMessage) {
    throw new ProtocolValidationError(`${kind} messages must include taskId.`, 'MISSING_TASK_ID');
  }

  const attempt = value.attempt === undefined ? 1 : value.attempt;
  if (!Number.isInteger(attempt) || (attempt as number) < 1) {
    throw new ProtocolValidationError('attempt must be a positive integer.', 'INVALID_ATTEMPT');
  }

  return {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    messageId,
    taskId: kind === 'request' ? createId() : suppliedTaskId || `lifecycle:${options.sourceId}`,
    parentTaskId: optionalString(value.parentTaskId, 'parentTaskId'),
    correlationId: optionalString(value.correlationId, 'correlationId'),
    from: options.sourceId,
    to: requiredString(value.to, 'to'),
    kind,
    payload: validatePayload(value.payload),
    attempt: kind === 'request' ? 1 : attempt as number,
    timestamp,
  };
};

export const getMessageInstruction = (message: AgentMessage): string => {
  if (message.payload.instruction) return message.payload.instruction;
  if (message.payload.summary) return message.payload.summary;
  if (message.payload.data !== undefined) return JSON.stringify(message.payload.data);
  return '';
};

export const formatRequestForAgent = (message: AgentMessage): string => {
  if (message.kind !== 'request') {
    return getMessageInstruction(message);
  }

  return [
    '[STARLIGHT TASK]',
    `Task ID: ${message.taskId}`,
    `Message ID: ${message.messageId}`,
    `Attempt: ${message.attempt}`,
    'If this Message ID was already accepted, do not execute it again; repeat the prior acknowledgement or result.',
    'Acknowledge before work with:',
    `  starlight-message ack --to ${message.from} --task-id ${message.taskId} --correlation-id ${message.messageId} --summary accepted`,
    'Report progress during long-running work with:',
    `  starlight-message progress --to ${message.from} --task-id ${message.taskId} --correlation-id ${message.messageId} --summary "status"`,
    'When complete return a structured result with:',
    `  starlight-message result --to ${message.from} --task-id ${message.taskId} --correlation-id ${message.messageId} --summary "outcome"`,
    '',
    'Instruction:',
    getMessageInstruction(message),
  ].join('\n');
};

export class BoundedMessageHistory<T extends { messageId: string }> {
  private items: T[] = [];
  private readonly limit: number;

  constructor(limit = DEFAULT_MESSAGE_HISTORY_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Message history limit must be a positive integer.');
    }
    this.limit = limit;
  }

  values(): T[] {
    return [...this.items];
  }

  append(item: T): T {
    this.items = [...this.items, item].slice(-this.limit);
    return item;
  }

  update(messageId: string, update: (item: T) => T): T | undefined {
    const current = this.items.find((item) => item.messageId === messageId);
    if (!current) return undefined;
    const updated = update(current);
    this.items = this.items.map((item) => item.messageId === messageId ? updated : item);
    return updated;
  }

  replaceAll(items: T[]) {
    this.items = [...items].slice(-this.limit);
  }
}

export type ReliableRequestStatus =
  | 'queued'
  | 'delivering'
  | 'delivered'
  | 'acknowledged'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ReliableRequestRecord {
  message: AgentMessage;
  status: ReliableRequestStatus;
  attempt: number;
  error?: string;
  deliveredAt?: number;
  acknowledgedAt?: number;
  completedAt?: number;
}

export interface ReliabilityOptions {
  acknowledgementTimeoutMs?: number;
  completionTimeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
}

export interface DeliveryGate {
  canDeliver(targetId: string, taskId?: string): boolean;
  onTaskStarted?(targetId: string, taskId: string): void;
}

export interface ReliabilityScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const defaultScheduler: ReliabilityScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const resolveReliabilityOptions = (
  options: ReliabilityOptions,
  current?: Required<ReliabilityOptions>
): Required<ReliabilityOptions> => {
  const resolved = {
    acknowledgementTimeoutMs: options.acknowledgementTimeoutMs ?? current?.acknowledgementTimeoutMs ?? 15_000,
    completionTimeoutMs: options.completionTimeoutMs ?? current?.completionTimeoutMs ?? 10 * 60_000,
    maxAttempts: options.maxAttempts ?? current?.maxAttempts ?? 3,
    retryBaseDelayMs: options.retryBaseDelayMs ?? current?.retryBaseDelayMs ?? 1_000,
  };
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${key} must be a positive integer.`);
    }
  }
  return resolved;
};

export type ResponseDisposition = 'accepted' | 'duplicate' | 'unmatched';

export class ReliableRequestManager {
  private readonly write: (targetId: string, data: string) => Promise<boolean>;
  private readonly onUpdate: (record: ReliableRequestRecord) => void;
  private readonly scheduler: ReliabilityScheduler;
  private readonly now: () => number;
  private readonly records = new Map<string, ReliableRequestRecord>();
  private readonly deadLetters = new Map<string, ReliableRequestRecord>();
  private readonly seenResponseKeys = new Set<string>();
  private readonly timers = new Map<string, unknown>();
  private readonly queues = new Map<string, string[]>();
  private readonly processingTargets = new Set<string>();
  private options: Required<ReliabilityOptions>;
  private readonly deliveryGate?: DeliveryGate;

  constructor(
    write: (targetId: string, data: string) => Promise<boolean>,
    onUpdate: (record: ReliableRequestRecord) => void = () => {},
    scheduler: ReliabilityScheduler = defaultScheduler,
    options: ReliabilityOptions = {},
    now: () => number = Date.now,
    deliveryGate?: DeliveryGate
  ) {
    this.write = write;
    this.onUpdate = onUpdate;
    this.scheduler = scheduler;
    this.now = now;
    this.deliveryGate = deliveryGate;
    this.options = resolveReliabilityOptions(options);
  }

  submit(message: AgentMessage): boolean {
    if (message.kind !== 'request') {
      throw new Error('Only request messages can be submitted for reliable delivery.');
    }
    if (this.records.has(message.messageId)) return false;

    const record: ReliableRequestRecord = {
      message: { ...message, attempt: 1 },
      status: 'queued',
      attempt: 0,
    };
    this.records.set(message.messageId, record);
    this.emit(record);
    this.enqueue(record);
    return true;
  }

  restore(message: AgentMessage): boolean {
    if (message.kind !== 'request' || this.records.has(message.messageId)) return false;
    const record: ReliableRequestRecord = {
      message: { ...message },
      status: 'queued',
      attempt: Math.max(0, message.attempt),
      error: 'Recovered after application restart.',
    };
    this.records.set(message.messageId, record);
    this.emit(record);
    this.enqueue(record);
    return true;
  }

  handleResponse(message: AgentMessage): ResponseDisposition {
    const record = this.findRequestForResponse(message);
    if (!record) return 'unmatched';

    const responseKey = [
      record.message.messageId,
      record.attempt,
      message.from,
      message.taskId,
      message.correlationId || '',
      message.kind,
      message.kind === 'progress' ? JSON.stringify(message.payload) : '',
    ].join(':');
    if (this.seenResponseKeys.has(responseKey)) return 'duplicate';
    this.seenResponseKeys.add(responseKey);

    if (['completed', 'cancelled'].includes(record.status)) return 'duplicate';

    this.clearTimer(record.message.messageId);
    if (message.kind === 'ack' || message.kind === 'progress') {
      this.deadLetters.delete(record.message.messageId);
      this.transition(record, {
        status: 'acknowledged',
        acknowledgedAt: this.now(),
        error: undefined,
      });
      this.scheduleCompletionTimeout(record);
      return 'accepted';
    }
    if (message.kind === 'result') {
      this.deadLetters.delete(record.message.messageId);
      this.transition(record, {
        status: 'completed',
        completedAt: this.now(),
        error: undefined,
      });
      return 'accepted';
    }
    if (message.kind === 'error') {
      this.fail(record, getMessageInstruction(message) || 'Agent reported an error.');
      return 'accepted';
    }
    if (message.kind === 'cancel') {
      this.transition(record, {
        status: 'cancelled',
        completedAt: this.now(),
        error: getMessageInstruction(message) || 'Cancelled by agent.',
      });
      return 'accepted';
    }
    return 'unmatched';
  }

  retry(messageId: string): boolean {
    const record = this.records.get(messageId);
    if (!record || !['failed', 'cancelled'].includes(record.status)) return false;
    this.clearTimer(messageId);
    this.deadLetters.delete(messageId);
    this.transition(record, {
      status: 'queued',
      error: undefined,
      deliveredAt: undefined,
      acknowledgedAt: undefined,
      completedAt: undefined,
    });
    this.enqueue(record);
    return true;
  }

  cancel(messageId: string, reason = 'Cancelled by operator.'): boolean {
    const record = this.records.get(messageId);
    if (!record || ['completed', 'cancelled'].includes(record.status)) return false;
    this.clearTimer(messageId);
    this.removeFromQueue(record.message.to, messageId);
    this.transition(record, { status: 'cancelled', completedAt: this.now(), error: reason });
    return true;
  }

  reassign(messageId: string, targetId: string): boolean {
    const record = this.records.get(messageId);
    if (!record || !['failed', 'cancelled'].includes(record.status) || !targetId.trim()) return false;
    this.clearTimer(messageId);
    this.deadLetters.delete(messageId);
    record.message = { ...record.message, to: targetId.trim() };
    this.transition(record, {
      status: 'queued',
      error: undefined,
      deliveredAt: undefined,
      acknowledgedAt: undefined,
      completedAt: undefined,
    });
    this.enqueue(record);
    return true;
  }

  failTarget(targetId: string, error: string): string[] {
    const failed: string[] = [];
    for (const record of this.records.values()) {
      if (
        record.message.to === targetId &&
        ['delivering', 'delivered', 'acknowledged'].includes(record.status)
      ) {
        this.fail(record, error);
        failed.push(record.message.messageId);
      }
    }
    return failed;
  }

  get(messageId: string): ReliableRequestRecord | undefined {
    const record = this.records.get(messageId);
    return record ? this.copy(record) : undefined;
  }

  getDeadLetters(): ReliableRequestRecord[] {
    return [...this.deadLetters.values()].map((record) => this.copy(record));
  }

  wakeTarget(targetId: string) {
    void this.process(targetId);
  }

  getOptions(): Required<ReliabilityOptions> {
    return { ...this.options };
  }

  configure(options: ReliabilityOptions) {
    this.options = resolveReliabilityOptions(options, this.options);
  }

  private findRequestForResponse(message: AgentMessage): ReliableRequestRecord | undefined {
    const correlated = message.correlationId ? this.records.get(message.correlationId) : undefined;
    if (
      correlated &&
      correlated.message.taskId === message.taskId &&
      correlated.message.to === message.from &&
      correlated.message.from === message.to
    ) {
      return correlated;
    }
    return [...this.records.values()].find((record) => (
      record.message.taskId === message.taskId &&
      record.message.to === message.from &&
      record.message.from === message.to
    ));
  }

  private enqueue(record: ReliableRequestRecord) {
    const target = record.message.to;
    const queue = this.queues.get(target) || [];
    if (!queue.includes(record.message.messageId)) {
      this.queues.set(target, [...queue, record.message.messageId]);
    }
    void this.process(target);
  }

  private async process(targetId: string) {
    if (this.processingTargets.has(targetId)) return;
    this.processingTargets.add(targetId);
    try {
      while (true) {
        const queue = this.queues.get(targetId) || [];
        if (queue.length === 0) break;
        const messageId = queue[0];
        const record = this.records.get(messageId);
        if (!record || record.status !== 'queued') {
          this.queues.set(targetId, queue.slice(1));
          continue;
        }
        if (this.deliveryGate && !this.deliveryGate.canDeliver(targetId, record.message.taskId)) break;
        this.queues.set(targetId, queue.slice(1));

        record.attempt += 1;
        record.message = { ...record.message, attempt: record.attempt };
        this.deliveryGate?.onTaskStarted?.(targetId, record.message.taskId);
        this.transition(record, {
          status: 'delivering',
          error: undefined,
          deliveredAt: undefined,
          acknowledgedAt: undefined,
          completedAt: undefined,
        });

        try {
          const delivered = await this.write(targetId, formatRequestForAgent(record.message) + '\r');
          if (delivered) {
            if (this.hasStatus(record, 'delivering')) {
              this.transition(record, { status: 'delivered', deliveredAt: this.now() });
              this.scheduleAcknowledgementTimeout(record);
            }
          } else {
            if (this.hasStatus(record, 'delivering')) {
              this.retryOrFail(record, `Target pane ${targetId} is not running.`);
            }
          }
        } catch (error) {
          if (this.hasStatus(record, 'delivering')) {
            this.retryOrFail(record, error instanceof Error ? error.message : String(error));
          }
        }
      }
    } finally {
      this.processingTargets.delete(targetId);
    }
  }

  private scheduleAcknowledgementTimeout(record: ReliableRequestRecord) {
    this.setTimer(record.message.messageId, () => {
      if (record.status === 'delivered') {
        this.retryOrFail(record, 'Acknowledgement timeout.');
      }
    }, this.options.acknowledgementTimeoutMs);
  }

  private scheduleCompletionTimeout(record: ReliableRequestRecord) {
    this.setTimer(record.message.messageId, () => {
      if (record.status === 'acknowledged') {
        this.fail(record, 'Task completion timeout.');
      }
    }, this.options.completionTimeoutMs);
  }

  private retryOrFail(record: ReliableRequestRecord, error: string) {
    this.clearTimer(record.message.messageId);
    if (record.attempt >= this.options.maxAttempts) {
      this.fail(record, error);
      return;
    }

    this.transition(record, {
      status: 'queued',
      error,
      deliveredAt: undefined,
      acknowledgedAt: undefined,
      completedAt: undefined,
    });
    const delay = this.options.retryBaseDelayMs * (2 ** (record.attempt - 1));
    this.setTimer(record.message.messageId, () => this.enqueue(record), delay);
  }

  private fail(record: ReliableRequestRecord, error: string) {
    this.clearTimer(record.message.messageId);
    this.transition(record, { status: 'failed', completedAt: this.now(), error });
    this.deadLetters.set(record.message.messageId, this.copy(record));
  }

  private transition(record: ReliableRequestRecord, patch: Partial<ReliableRequestRecord>) {
    Object.assign(record, patch);
    this.emit(record);
  }

  private hasStatus(record: ReliableRequestRecord, status: ReliableRequestStatus): boolean {
    return record.status === status;
  }

  private emit(record: ReliableRequestRecord) {
    this.onUpdate(this.copy(record));
  }

  private copy(record: ReliableRequestRecord): ReliableRequestRecord {
    return { ...record, message: { ...record.message, payload: { ...record.message.payload } } };
  }

  private setTimer(messageId: string, callback: () => void, delayMs: number) {
    this.clearTimer(messageId);
    this.timers.set(messageId, this.scheduler.schedule(callback, delayMs));
  }

  private clearTimer(messageId: string) {
    const timer = this.timers.get(messageId);
    if (timer !== undefined) {
      this.scheduler.cancel(timer);
      this.timers.delete(messageId);
    }
  }

  private removeFromQueue(targetId: string, messageId: string) {
    const queue = this.queues.get(targetId) || [];
    this.queues.set(targetId, queue.filter((id) => id !== messageId));
  }
}

export type AgentLifecycleState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'busy'
  | 'unresponsive'
  | 'failed'
  | 'stopping';

export interface AgentLifecycleRecord {
  agentId: string;
  state: AgentLifecycleState;
  role?: string;
  capabilities?: string[];
  tools?: string[];
  promptVersion?: number;
  currentTaskId?: string;
  lastHeartbeatAt?: number;
  error?: string;
}

export interface AgentLifecycleOptions {
  heartbeatTimeoutMs?: number;
}

export class AgentLifecycleManager {
  private readonly agents = new Map<string, AgentLifecycleRecord>();
  private readonly heartbeatTimeoutMs: number;
  private readonly onUpdate: (record: AgentLifecycleRecord) => void;
  private readonly now: () => number;

  constructor(
    onUpdate: (record: AgentLifecycleRecord) => void = () => {},
    options: AgentLifecycleOptions = {},
    now: () => number = Date.now
  ) {
    this.onUpdate = onUpdate;
    this.now = now;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 30_000;
    if (!Number.isInteger(this.heartbeatTimeoutMs) || this.heartbeatTimeoutMs < 1) {
      throw new Error('heartbeatTimeoutMs must be a positive integer.');
    }
  }

  register(
    agentId: string,
    contract: Pick<AgentLifecycleRecord, 'role' | 'capabilities' | 'tools' | 'promptVersion'> = {}
  ): AgentLifecycleRecord {
    const current = this.agents.get(agentId);
    if (current) return this.set(agentId, contract);
    return this.set(agentId, { state: 'stopped', ...contract });
  }

  restore(record: AgentLifecycleRecord): AgentLifecycleRecord {
    const restored = {
      ...record,
      capabilities: [...(record.capabilities || [])],
      tools: [...(record.tools || [])],
    };
    this.agents.set(record.agentId, restored);
    return { ...restored, capabilities: [...restored.capabilities], tools: [...restored.tools] };
  }

  starting(agentId: string): AgentLifecycleRecord {
    return this.set(agentId, {
      state: 'starting',
      currentTaskId: undefined,
      error: undefined,
      lastHeartbeatAt: this.now(),
    });
  }

  ready(agentId: string): AgentLifecycleRecord {
    return this.set(agentId, {
      state: 'ready',
      currentTaskId: undefined,
      error: undefined,
      lastHeartbeatAt: this.now(),
    });
  }

  heartbeat(agentId: string): AgentLifecycleRecord {
    const current = this.agents.get(agentId);
    const state = current?.state === 'unresponsive'
      ? (current.currentTaskId ? 'busy' : 'ready')
      : current?.state || 'ready';
    return this.set(agentId, { state, lastHeartbeatAt: this.now(), error: undefined });
  }

  taskStarted(agentId: string, taskId: string): AgentLifecycleRecord {
    return this.set(agentId, {
      state: 'busy',
      currentTaskId: taskId,
      lastHeartbeatAt: this.now(),
      error: undefined,
    });
  }

  taskFinished(agentId: string, taskId?: string): AgentLifecycleRecord {
    const current = this.agents.get(agentId);
    if (taskId && current?.currentTaskId !== taskId) {
      return current ? { ...current } : this.register(agentId);
    }
    return this.set(agentId, {
      state: 'ready',
      currentTaskId: undefined,
      lastHeartbeatAt: this.now(),
      error: undefined,
    });
  }

  stopping(agentId: string): AgentLifecycleRecord {
    return this.set(agentId, { state: 'stopping' });
  }

  stopped(agentId: string): AgentLifecycleRecord {
    return this.set(agentId, { state: 'stopped', currentTaskId: undefined });
  }

  failed(agentId: string, error: string): AgentLifecycleRecord {
    return this.set(agentId, { state: 'failed', currentTaskId: undefined, error });
  }

  unresponsive(agentId: string, error = 'Agent is unresponsive.'): AgentLifecycleRecord {
    return this.set(agentId, { state: 'unresponsive', error });
  }

  checkHealth(): AgentLifecycleRecord[] {
    const changed: AgentLifecycleRecord[] = [];
    for (const record of this.agents.values()) {
      if (
        ['ready', 'busy'].includes(record.state) &&
        record.lastHeartbeatAt !== undefined &&
        this.now() - record.lastHeartbeatAt > this.heartbeatTimeoutMs
      ) {
        changed.push(this.set(record.agentId, {
          state: 'unresponsive',
          error: 'Heartbeat timeout.',
        }));
      }
    }
    return changed;
  }

  canAcceptTask(agentId: string, taskId?: string): boolean {
    const agent = this.agents.get(agentId);
    return agent?.state === 'ready' || (
      agent?.state === 'busy' &&
      taskId !== undefined &&
      agent.currentTaskId === taskId
    );
  }

  get(agentId: string): AgentLifecycleRecord | undefined {
    const record = this.agents.get(agentId);
    return record ? {
      ...record,
      capabilities: [...(record.capabilities || [])],
      tools: [...(record.tools || [])],
    } : undefined;
  }

  values(): AgentLifecycleRecord[] {
    return [...this.agents.values()].map((record) => ({
      ...record,
      capabilities: [...(record.capabilities || [])],
      tools: [...(record.tools || [])],
    }));
  }

  private set(agentId: string, patch: Partial<AgentLifecycleRecord>): AgentLifecycleRecord {
    const current = this.agents.get(agentId) || { agentId, state: 'stopped' as const };
    const updated = { ...current, ...patch, agentId };
    this.agents.set(agentId, updated);
    const copy = {
      ...updated,
      capabilities: [...(updated.capabilities || [])],
      tools: [...(updated.tools || [])],
    };
    this.onUpdate(copy);
    return copy;
  }
}

export const stripAnsi = (text: string): string => {
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
};

const stripCodeFence = (payload: string): string => {
  const trimmed = payload.trim();
  const withoutOpeningFence = trimmed.replace(/^```(?:json)?\s*/i, '');
  return withoutOpeningFence.replace(/\s*```$/, '').trim();
};

export class StarlightEnvelopeParser {
  private readonly buffers = new Map<string, string>();

  push(sourceId: string, chunk: string): { messages: ParsedEnvelope[]; errors: EnvelopeParseError[] } {
    const messages: ParsedEnvelope[] = [];
    const errors: EnvelopeParseError[] = [];
    let buffer = stripAnsi((this.buffers.get(sourceId) || '') + chunk);

    while (true) {
      const startIndex = buffer.indexOf(STARLIGHT_START_TAG);
      if (startIndex === -1) {
        buffer = buffer.slice(-Math.min(buffer.length, STARLIGHT_START_TAG.length - 1));
        break;
      }

      const payloadStart = startIndex + STARLIGHT_START_TAG.length;
      const endIndex = buffer.indexOf(STARLIGHT_END_TAG, payloadStart);
      if (endIndex === -1) {
        buffer = buffer.slice(startIndex);
        break;
      }

      // Streaming terminal UIs may redraw a partial response before printing the
      // final envelope. Prefer the innermost complete envelope in that case.
      const nestedStartIndex = buffer.lastIndexOf(STARLIGHT_START_TAG, endIndex);
      const effectivePayloadStart = nestedStartIndex > startIndex
        ? nestedStartIndex + STARLIGHT_START_TAG.length
        : payloadStart;
      const payload = stripCodeFence(buffer.slice(effectivePayloadStart, endIndex));
      try {
        const envelope = JSON.parse(payload) as StarlightEnvelope;
        messages.push({ sourceId, envelope });
      } catch (error) {
        errors.push({ sourceId, payload, error });
      }

      buffer = buffer.slice(endIndex + STARLIGHT_END_TAG.length);
    }

    if (buffer.length > MAX_BUFFER_LENGTH) {
      buffer = buffer.slice(-MAX_BUFFER_LENGTH);
    }
    this.buffers.set(sourceId, buffer);

    return { messages, errors };
  }

  reset(sourceId?: string) {
    if (sourceId) {
      this.buffers.delete(sourceId);
      return;
    }
    this.buffers.clear();
  }
}

export const isRouteAllowed = (
  connections: Record<string, string[]>,
  source: string,
  target: string
): boolean => {
  if (Object.keys(connections).length === 0) {
    return true;
  }
  return (connections[source] || []).includes(target);
};

export interface DeliveryEntry {
  command: string;
  messageId?: string;
}

export type DeliveryStatus = 'delivering' | 'delivered' | 'failed';

export class PtyDeliveryQueue {
  private readonly queues = new Map<string, DeliveryEntry[]>();
  private readonly processingTargets = new Set<string>();
  private readonly write: (targetId: string, data: string) => Promise<boolean>;
  private readonly onQueueChange: (targetId: string, entries: DeliveryEntry[]) => void;
  private readonly onStatusChange: (
    entry: DeliveryEntry,
    status: DeliveryStatus,
    error?: string
  ) => void;
  private readonly deliveryDelayMs: number;

  constructor(
    write: (targetId: string, data: string) => Promise<boolean>,
    onQueueChange: (targetId: string, entries: DeliveryEntry[]) => void = () => {},
    onStatusChange: (
      entry: DeliveryEntry,
      status: DeliveryStatus,
      error?: string
    ) => void = () => {},
    deliveryDelayMs = 100
  ) {
    this.write = write;
    this.onQueueChange = onQueueChange;
    this.onStatusChange = onStatusChange;
    this.deliveryDelayMs = deliveryDelayMs;
  }

  enqueue(targetId: string, entry: DeliveryEntry) {
    const queue = this.queues.get(targetId) || [];
    this.queues.set(targetId, [...queue, entry]);
    this.notifyQueueChange(targetId);
    void this.process(targetId);
  }

  getQueue(targetId: string): DeliveryEntry[] {
    return [...(this.queues.get(targetId) || [])];
  }

  async waitForIdle(targetId: string): Promise<void> {
    while (this.processingTargets.has(targetId) || this.getQueue(targetId).length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private notifyQueueChange(targetId: string) {
    this.onQueueChange(targetId, this.getQueue(targetId));
  }

  private async process(targetId: string) {
    if (this.processingTargets.has(targetId)) return;
    this.processingTargets.add(targetId);

    try {
      while (true) {
        const queue = this.queues.get(targetId) || [];
        if (queue.length === 0) break;

        const entry = queue[0];
        this.queues.set(targetId, queue.slice(1));
        this.notifyQueueChange(targetId);
        this.onStatusChange(entry, 'delivering');

        try {
          const delivered = await this.write(targetId, entry.command + '\r');
          this.onStatusChange(
            entry,
            delivered ? 'delivered' : 'failed',
            delivered ? undefined : `Target pane ${targetId} is not running.`
          );
        } catch (error) {
          this.onStatusChange(
            entry,
            'failed',
            error instanceof Error ? error.message : String(error)
          );
        }

        if (this.deliveryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.deliveryDelayMs));
        }
      }
    } finally {
      this.processingTargets.delete(targetId);
    }
  }
}
