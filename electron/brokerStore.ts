import { createRequire } from 'module';

export const BROKER_SCHEMA_VERSION = 2;
export const BROKER_PROTOCOL_VERSION = 1;
export const DEFAULT_BROKER_RETENTION_LIMIT = 5_000;

export interface DurableAgentRecord {
  agentId: string;
  state: string;
  currentTaskId?: string;
  lastHeartbeatAt?: number;
  error?: string;
}

export interface DurableMessageRecord {
  messageId: string;
  taskId: string;
  from: string;
  to: string;
  kind: string;
  status: string;
  attempt: number;
  timestamp: number;
  payload: unknown;
  command?: string;
  correlationId?: string;
  parentTaskId?: string;
  error?: string;
  deliveredAt?: number;
  acknowledgedAt?: number;
  completedAt?: number;
  protocolVersion: number;
  type?: string;
  id?: string;
}

export interface DurableBrokerEvent {
  sequence: number;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  createdAt: number;
}

export interface DurableBrokerSnapshot {
  schemaVersion: number;
  agents: DurableAgentRecord[];
  messages: DurableMessageRecord[];
  tasks: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  workflows: Array<Record<string, unknown>>;
  events: DurableBrokerEvent[];
  settings: Record<string, unknown>;
}

export interface BrokerStoreOptions {
  retentionLimit?: number;
  now?: () => number;
}

interface DatabaseStatement {
  run(...params: any[]): unknown;
  get(...params: any[]): unknown;
  all(...params: any[]): unknown[];
}

interface DatabaseLike {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): DatabaseStatement;
}

const localRequire = createRequire(`${process.cwd()}/package.json`);

const createDatabase = (filename: string): DatabaseLike => {
  try {
    const { DatabaseSync } = localRequire('node:sqlite');
    return new DatabaseSync(filename) as DatabaseLike;
  } catch {
    const BetterSqlite3 = localRequire('better-sqlite3');
    return new BetterSqlite3(filename) as DatabaseLike;
  }
};

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export class BrokerStore {
  private readonly db: DatabaseLike;
  private readonly now: () => number;
  private retentionLimit: number;

  constructor(filename: string, options: BrokerStoreOptions = {}) {
    this.db = createDatabase(filename);
    this.now = options.now || Date.now;
    this.retentionLimit = options.retentionLimit || DEFAULT_BROKER_RETENTION_LIMIT;
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
    this.migrateProtocolMessages();
    const savedLimit = this.getSetting<number>('retentionLimit');
    if (savedLimit) this.retentionLimit = savedLimit;
  }

  close() {
    this.db.close();
  }

  getSchemaVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    return row.user_version;
  }

  upsertAgent(agent: DurableAgentRecord) {
    const timestamp = this.now();
    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO agents (agent_id, state, current_task_id, last_heartbeat_at, error, updated_at)
        VALUES (@agentId, @state, @currentTaskId, @lastHeartbeatAt, @error, @updatedAt)
        ON CONFLICT(agent_id) DO UPDATE SET
          state = excluded.state,
          current_task_id = excluded.current_task_id,
          last_heartbeat_at = excluded.last_heartbeat_at,
          error = excluded.error,
          updated_at = excluded.updated_at
      `).run({
        ...agent,
        currentTaskId: agent.currentTaskId || null,
        lastHeartbeatAt: agent.lastHeartbeatAt || null,
        error: agent.error || null,
        updatedAt: timestamp,
      });
      this.insertEvent('agent.updated', 'agent', agent.agentId, agent, timestamp);
      this.cleanup();
    });
  }

  upsertMessage(message: DurableMessageRecord) {
    const timestamp = this.now();
    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO messages (
          message_id, task_id, parent_task_id, correlation_id, source_id, target_id,
          kind, status, attempt, protocol_version, payload_json, command, error,
          created_at, updated_at, delivered_at, acknowledged_at, completed_at
        ) VALUES (
          @messageId, @taskId, @parentTaskId, @correlationId, @from, @to,
          @kind, @status, @attempt, @protocolVersion, @payloadJson, @command, @error,
          @createdAt, @updatedAt, @deliveredAt, @acknowledgedAt, @completedAt
        )
        ON CONFLICT(message_id) DO UPDATE SET
          target_id = excluded.target_id,
          status = excluded.status,
          attempt = excluded.attempt,
          payload_json = excluded.payload_json,
          command = excluded.command,
          error = excluded.error,
          updated_at = excluded.updated_at,
          delivered_at = excluded.delivered_at,
          acknowledged_at = excluded.acknowledged_at,
          completed_at = excluded.completed_at
      `).run({
        messageId: message.messageId,
        taskId: message.taskId,
        parentTaskId: message.parentTaskId || null,
        correlationId: message.correlationId || null,
        from: message.from,
        to: message.to,
        kind: message.kind,
        status: message.status,
        attempt: message.attempt,
        protocolVersion: message.protocolVersion,
        payloadJson: JSON.stringify(message.payload || {}),
        command: message.command || null,
        error: message.error || null,
        createdAt: message.timestamp,
        updatedAt: timestamp,
        deliveredAt: message.deliveredAt || null,
        acknowledgedAt: message.acknowledgedAt || null,
        completedAt: message.completedAt || null,
      });

      if (message.kind === 'request') {
        this.upsertTask(message, timestamp);
        this.db.prepare(`
          INSERT INTO attempts (message_id, attempt, target_id, status, error, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(message_id, attempt) DO UPDATE SET
            target_id = excluded.target_id,
            status = excluded.status,
            error = excluded.error,
            updated_at = excluded.updated_at
        `).run(
          message.messageId,
          message.attempt,
          message.to,
          message.status,
          message.error || null,
          timestamp,
          timestamp
        );
      }
      this.insertEvent('message.updated', 'message', message.messageId, message, timestamp);
      this.cleanup();
    });
  }

  upsertWorkflow(workflow: any) {
    const timestamp = this.now();
    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO workflows (workflow_id, name, goal, created_by, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workflow_id) DO UPDATE SET
          name = excluded.name,
          goal = excluded.goal,
          status = excluded.status,
          updated_at = excluded.updated_at
      `).run(
        workflow.id,
        workflow.name,
        workflow.goal,
        workflow.createdBy,
        workflow.status,
        workflow.createdAt || timestamp,
        workflow.updatedAt || timestamp
      );
      for (const task of workflow.tasks || []) {
        this.db.prepare(`
          INSERT INTO workflow_tasks (
            workflow_id, task_id, owner, goal, dependencies_json, status, attempts,
            artifacts_json, completion_criteria_json, failure_policy, max_attempts,
            requires_approval, approved, message_id, summary, error, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workflow_id, task_id) DO UPDATE SET
            owner = excluded.owner,
            goal = excluded.goal,
            dependencies_json = excluded.dependencies_json,
            status = excluded.status,
            attempts = excluded.attempts,
            artifacts_json = excluded.artifacts_json,
            completion_criteria_json = excluded.completion_criteria_json,
            failure_policy = excluded.failure_policy,
            max_attempts = excluded.max_attempts,
            requires_approval = excluded.requires_approval,
            approved = excluded.approved,
            message_id = excluded.message_id,
            summary = excluded.summary,
            error = excluded.error,
            updated_at = excluded.updated_at
        `).run(
          workflow.id,
          task.id,
          task.owner,
          task.goal,
          JSON.stringify(task.dependencies || []),
          task.status,
          task.attempts || 0,
          JSON.stringify(task.artifacts || []),
          JSON.stringify(task.completionCriteria || null),
          task.failurePolicy || 'block',
          task.maxAttempts || 1,
          task.requiresApproval ? 1 : 0,
          task.approved ? 1 : 0,
          task.messageId || null,
          task.summary || null,
          task.error || null,
          timestamp
        );
      }
      this.insertEvent('workflow.updated', 'workflow', workflow.id, workflow, timestamp);
      this.cleanup();
    });
  }

  setSetting(key: string, value: unknown) {
    this.db.prepare(`
      INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), this.now());
    if (key === 'retentionLimit' && Number.isInteger(value) && (value as number) > 0) {
      this.retentionLimit = value as number;
      this.cleanup();
    }
  }

  getSetting<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
      | { value_json: string }
      | undefined;
    return row ? parseJson<T | undefined>(row.value_json, undefined) : undefined;
  }

  recoverInterruptedWork(): number {
    const timestamp = this.now();
    return this.transaction(() => {
      this.db.prepare(`
        UPDATE agents SET state = 'stopped', current_task_id = NULL, error = NULL, updated_at = ?
        WHERE state != 'stopped'
      `).run(timestamp);
      const interrupted = this.db.prepare(`
        SELECT message_id FROM messages
        WHERE kind = 'request' AND status IN ('delivering', 'delivered', 'acknowledged')
      `).all() as Array<{ message_id: string }>;
      this.db.prepare(`
        UPDATE messages
        SET status = 'queued', error = 'Recovered after application restart.',
            delivered_at = NULL, acknowledged_at = NULL, completed_at = NULL, updated_at = ?
        WHERE kind = 'request' AND status IN ('delivering', 'delivered', 'acknowledged')
      `).run(timestamp);
      this.db.prepare(`
        UPDATE tasks SET status = 'queued', updated_at = ?
        WHERE status IN ('delivering', 'delivered', 'acknowledged')
      `).run(timestamp);
      this.db.prepare(`
        UPDATE workflow_tasks SET status = 'ready', error = 'Recovered after application restart.', updated_at = ?
        WHERE status IN ('assigned', 'running', 'reviewing')
      `).run(timestamp);
      interrupted.forEach(({ message_id }) => {
        this.insertEvent(
          'message.recovered',
          'message',
          message_id,
          { status: 'queued', reason: 'application_restart' },
          timestamp
        );
      });
      return interrupted.length;
    });
  }

  snapshot(): DurableBrokerSnapshot {
    const agents = this.db.prepare(`
      SELECT agent_id, state, current_task_id, last_heartbeat_at, error FROM agents ORDER BY agent_id
    `).all().map((row: any) => ({
      agentId: row.agent_id,
      state: row.state,
      currentTaskId: row.current_task_id || undefined,
      lastHeartbeatAt: row.last_heartbeat_at || undefined,
      error: row.error || undefined,
    }));
    const messages = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM messages ORDER BY created_at DESC LIMIT ?
      ) ORDER BY created_at ASC
    `).all(this.retentionLimit).map((row: any) => ({
      protocolVersion: row.protocol_version,
      messageId: row.message_id,
      id: row.message_id,
      taskId: row.task_id,
      parentTaskId: row.parent_task_id || undefined,
      correlationId: row.correlation_id || undefined,
      from: row.source_id,
      to: row.target_id,
      kind: row.kind,
      payload: parseJson(row.payload_json, {}),
      attempt: row.attempt,
      timestamp: row.created_at,
      command: row.command || '',
      type: row.kind,
      status: row.status,
      error: row.error || undefined,
      deliveredAt: row.delivered_at || undefined,
      acknowledgedAt: row.acknowledged_at || undefined,
      completedAt: row.completed_at || undefined,
    }));
    const events = this.db.prepare(`
      SELECT sequence, event_type, entity_type, entity_id, payload_json, created_at
      FROM events ORDER BY sequence DESC LIMIT ?
    `).all(this.retentionLimit).reverse().map((row: any) => ({
      sequence: row.sequence,
      eventType: row.event_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      payload: parseJson(row.payload_json, {}),
      createdAt: row.created_at,
    }));
    const settings = Object.fromEntries((this.db.prepare('SELECT key, value_json FROM settings').all() as any[])
      .map((row) => [row.key, parseJson(row.value_json, null)]));
    const tasks = this.db.prepare('SELECT * FROM tasks ORDER BY created_at ASC').all() as Array<Record<string, unknown>>;
    const attempts = this.db.prepare('SELECT * FROM attempts ORDER BY created_at ASC').all() as Array<Record<string, unknown>>;
    const workflowRows = this.db.prepare('SELECT * FROM workflows ORDER BY created_at ASC').all() as any[];
    const workflowTasks = this.db.prepare('SELECT * FROM workflow_tasks ORDER BY workflow_id, task_id').all() as any[];
    const workflows = workflowRows.map((workflow) => ({
      id: workflow.workflow_id,
      name: workflow.name,
      goal: workflow.goal,
      createdBy: workflow.created_by,
      status: workflow.status,
      createdAt: workflow.created_at,
      updatedAt: workflow.updated_at,
      tasks: workflowTasks.filter((task) => task.workflow_id === workflow.workflow_id).map((task) => ({
        workflowId: task.workflow_id,
        id: task.task_id,
        owner: task.owner,
        goal: task.goal,
        dependencies: parseJson(task.dependencies_json, []),
        status: task.status,
        attempts: task.attempts,
        artifacts: parseJson(task.artifacts_json, []),
        completionCriteria: parseJson(task.completion_criteria_json, undefined),
        failurePolicy: task.failure_policy,
        maxAttempts: task.max_attempts,
        requiresApproval: Boolean(task.requires_approval),
        approved: Boolean(task.approved),
        messageId: task.message_id || undefined,
        summary: task.summary || undefined,
        error: task.error || undefined,
      })),
    }));
    return { schemaVersion: this.getSchemaVersion(), agents, messages, tasks, attempts, workflows, events, settings };
  }

  private migrate() {
    const version = this.getSchemaVersion();
    if (version > BROKER_SCHEMA_VERSION) {
      throw new Error(`Broker database schema ${version} is newer than supported version ${BROKER_SCHEMA_VERSION}.`);
    }
    if (version < 1) {
      this.db.exec(`
        CREATE TABLE agents (
          agent_id TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          current_task_id TEXT,
          last_heartbeat_at INTEGER,
          error TEXT,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE messages (
          message_id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          parent_task_id TEXT,
          correlation_id TEXT,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          attempt INTEGER NOT NULL,
          protocol_version INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          command TEXT,
          error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          delivered_at INTEGER,
          acknowledged_at INTEGER,
          completed_at INTEGER
        );
        CREATE TABLE tasks (
          task_id TEXT PRIMARY KEY,
          request_message_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          status TEXT NOT NULL,
          instruction TEXT,
          attempt INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE attempts (
          message_id TEXT NOT NULL,
          attempt INTEGER NOT NULL,
          target_id TEXT NOT NULL,
          status TEXT NOT NULL,
          error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (message_id, attempt)
        );
        CREATE TABLE events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX messages_task_id_idx ON messages(task_id);
        CREATE INDEX messages_status_idx ON messages(status);
        CREATE INDEX events_entity_idx ON events(entity_type, entity_id);
      `);
    }
    if (version < 2) {
      this.db.exec(`
        CREATE TABLE workflows (
          workflow_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          goal TEXT NOT NULL,
          created_by TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE workflow_tasks (
          workflow_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          owner TEXT NOT NULL,
          goal TEXT NOT NULL,
          dependencies_json TEXT NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL,
          artifacts_json TEXT NOT NULL,
          completion_criteria_json TEXT,
          failure_policy TEXT NOT NULL,
          max_attempts INTEGER NOT NULL,
          requires_approval INTEGER NOT NULL,
          approved INTEGER NOT NULL,
          message_id TEXT,
          summary TEXT,
          error TEXT,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (workflow_id, task_id),
          FOREIGN KEY (workflow_id) REFERENCES workflows(workflow_id) ON DELETE CASCADE
        );
        CREATE INDEX workflow_tasks_status_idx ON workflow_tasks(status);
      `);
    }
    this.db.exec(`PRAGMA user_version = ${BROKER_SCHEMA_VERSION};`);
  }

  private upsertTask(message: DurableMessageRecord, timestamp: number) {
    const instruction = (message.payload as any)?.instruction || message.command || null;
    this.db.prepare(`
      INSERT INTO tasks (
        task_id, request_message_id, source_id, target_id, status, instruction,
        attempt, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        target_id = excluded.target_id,
        status = excluded.status,
        instruction = excluded.instruction,
        attempt = excluded.attempt,
        updated_at = excluded.updated_at
    `).run(
      message.taskId,
      message.messageId,
      message.from,
      message.to,
      message.status,
      instruction,
      message.attempt,
      message.timestamp,
      timestamp
    );
  }

  private migrateProtocolMessages() {
    const newer = this.db.prepare(`
      SELECT message_id FROM messages WHERE protocol_version > ? LIMIT 1
    `).get(BROKER_PROTOCOL_VERSION) as { message_id: string } | undefined;
    if (newer) {
      throw new Error(`Message ${newer.message_id} uses a newer unsupported protocol version.`);
    }
    const legacy = this.db.prepare(`
      SELECT message_id FROM messages WHERE protocol_version < ?
    `).all(BROKER_PROTOCOL_VERSION) as Array<{ message_id: string }>;
    if (legacy.length === 0) return;
    const timestamp = this.now();
    this.transaction(() => {
      this.db.prepare('UPDATE messages SET protocol_version = ?, updated_at = ? WHERE protocol_version < ?')
        .run(BROKER_PROTOCOL_VERSION, timestamp, BROKER_PROTOCOL_VERSION);
      legacy.forEach(({ message_id }) => {
        this.insertEvent(
          'message.protocol_migrated',
          'message',
          message_id,
          { protocolVersion: BROKER_PROTOCOL_VERSION },
          timestamp
        );
      });
    });
  }

  private insertEvent(
    eventType: string,
    entityType: string,
    entityId: string,
    payload: unknown,
    timestamp: number
  ) {
    this.db.prepare(`
      INSERT INTO events (event_type, entity_type, entity_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(eventType, entityType, entityId, JSON.stringify(payload), timestamp);
  }

  private cleanup() {
    this.db.prepare(`
      DELETE FROM events WHERE sequence NOT IN (
        SELECT sequence FROM events ORDER BY sequence DESC LIMIT ?
      )
    `).run(this.retentionLimit);
    this.db.prepare(`
      DELETE FROM attempts WHERE message_id IN (
        SELECT message_id FROM messages
        WHERE status IN ('completed', 'failed', 'cancelled')
        ORDER BY updated_at DESC LIMIT -1 OFFSET ?
      )
    `).run(this.retentionLimit);
    this.db.prepare(`
      DELETE FROM tasks WHERE request_message_id IN (
        SELECT message_id FROM messages
        WHERE status IN ('completed', 'failed', 'cancelled')
        ORDER BY updated_at DESC LIMIT -1 OFFSET ?
      )
    `).run(this.retentionLimit);
    this.db.prepare(`
      DELETE FROM messages WHERE message_id IN (
        SELECT message_id FROM messages
        WHERE status IN ('completed', 'failed', 'cancelled')
        ORDER BY updated_at DESC LIMIT -1 OFFSET ?
      )
    `).run(this.retentionLimit);
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
