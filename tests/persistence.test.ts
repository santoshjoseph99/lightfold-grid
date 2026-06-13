import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { BROKER_PROTOCOL_VERSION, BROKER_SCHEMA_VERSION, BrokerStore } from '../electron/brokerStore.ts';
import type { DurableMessageRecord } from '../electron/brokerStore.ts';

const request = (status = 'queued', attempt = 1): DurableMessageRecord => ({
  protocolVersion: 1,
  messageId: 'message-1',
  taskId: 'task-1',
  from: 'Hub',
  to: 'Spoke-A',
  kind: 'request',
  payload: { instruction: 'implement durable state' },
  command: 'implement durable state',
  status,
  attempt,
  timestamp: 100,
});

const withStore = (run: (store: BrokerStore, filename: string) => void) => {
  const directory = mkdtempSync(join(tmpdir(), 'starlight-broker-'));
  const filename = join(directory, 'broker.sqlite');
  const store = new BrokerStore(filename);
  try {
    run(store, filename);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
};

test('migrates an empty database and persists normalized broker state', () => {
  withStore((store) => {
    assert.equal(store.getSchemaVersion(), BROKER_SCHEMA_VERSION);
    store.upsertAgent({ agentId: 'Spoke-A', state: 'ready', lastHeartbeatAt: 200 });
    store.upsertMessage(request('delivered'));

    const snapshot = store.snapshot();
    assert.equal(snapshot.agents[0].state, 'ready');
    assert.equal(snapshot.messages[0].status, 'delivered');
    assert.equal(snapshot.tasks.length, 1);
    assert.equal(snapshot.attempts.length, 1);
    assert.equal(snapshot.events.length, 2);
    assert.deepEqual(snapshot.messages[0].payload, { instruction: 'implement durable state' });
  });
});

test('recovers interrupted deliveries and preserves stable task identity after restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'starlight-recovery-'));
  const filename = join(directory, 'broker.sqlite');
  const first = new BrokerStore(filename);
  first.upsertAgent({ agentId: 'Spoke-A', state: 'busy', currentTaskId: 'task-1' });
  first.upsertMessage(request('acknowledged', 2));
  first.close();

  const restarted = new BrokerStore(filename);
  assert.equal(restarted.recoverInterruptedWork(), 1);
  const snapshot = restarted.snapshot();
  assert.equal(snapshot.agents[0].state, 'stopped');
  assert.equal(snapshot.messages[0].status, 'queued');
  assert.equal(snapshot.messages[0].messageId, 'message-1');
  assert.equal(snapshot.messages[0].taskId, 'task-1');
  assert.equal(snapshot.messages[0].attempt, 2);
  assert.equal(snapshot.events.some((event) => event.eventType === 'message.recovered'), true);
  restarted.close();
  rmSync(directory, { recursive: true, force: true });
});

test('applies retention settings to completed messages and append-only events', () => {
  withStore((store) => {
    store.setSetting('retentionLimit', 2);
    for (let index = 1; index <= 4; index += 1) {
      store.upsertMessage({
        ...request('completed'),
        messageId: `message-${index}`,
        taskId: `task-${index}`,
        completedAt: 100 + index,
        timestamp: 100 + index,
      });
    }
    const snapshot = store.snapshot();
    assert.equal(snapshot.messages.length, 2);
    assert.equal(snapshot.tasks.length, 2);
    assert.equal(snapshot.attempts.length, 2);
    assert.equal(snapshot.events.length, 2);
    assert.equal(snapshot.settings.retentionLimit, 2);
  });
});

test('migrates older persisted protocol messages on reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'starlight-protocol-migration-'));
  const filename = join(directory, 'broker.sqlite');
  const first = new BrokerStore(filename);
  first.upsertMessage({ ...request(), protocolVersion: 0 });
  first.close();

  const migrated = new BrokerStore(filename);
  const snapshot = migrated.snapshot();
  assert.equal(snapshot.messages[0].protocolVersion, BROKER_PROTOCOL_VERSION);
  assert.equal(snapshot.events.some((event) => event.eventType === 'message.protocol_migrated'), true);
  migrated.close();
  rmSync(directory, { recursive: true, force: true });
});

test('persists workflow graphs and task execution state', () => {
  withStore((store) => {
    store.upsertWorkflow({
      id: 'workflow-1',
      name: 'Feature',
      goal: 'Ship feature',
      createdBy: 'Hub',
      status: 'running',
      createdAt: 100,
      updatedAt: 200,
      tasks: [
        {
          workflowId: 'workflow-1',
          id: 'spec',
          owner: 'Spec',
          goal: 'Write spec',
          dependencies: [],
          status: 'completed',
          attempts: 1,
          artifacts: ['spec.md'],
          failurePolicy: 'block',
          maxAttempts: 1,
          approved: true,
        },
        {
          workflowId: 'workflow-1',
          id: 'release',
          owner: 'Release',
          goal: 'Publish release',
          dependencies: ['spec'],
          status: 'ready',
          attempts: 0,
          artifacts: [],
          failurePolicy: 'cancel-workflow',
          maxAttempts: 1,
          requiresApproval: true,
          approved: false,
        },
      ],
    });
    const snapshot = store.snapshot();
    assert.equal(snapshot.workflows.length, 1);
    const release = (snapshot.workflows[0] as any).tasks.find((task: any) => task.id === 'release');
    assert.equal(release.dependencies[0], 'spec');
    assert.equal(release.requiresApproval, true);
    assert.equal(snapshot.events.some((event) => event.eventType === 'workflow.updated'), true);
  });
});

test('migrates a milestone-four database through the current schema', () => {
  const directory = mkdtempSync(join(tmpdir(), 'starlight-schema-migration-'));
  const filename = join(directory, 'broker.sqlite');
  const legacy = new DatabaseSync(filename);
  legacy.exec(`
    CREATE TABLE agents (agent_id TEXT PRIMARY KEY, state TEXT NOT NULL, current_task_id TEXT, last_heartbeat_at INTEGER, error TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE messages (message_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, parent_task_id TEXT, correlation_id TEXT, source_id TEXT NOT NULL, target_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL, protocol_version INTEGER NOT NULL, payload_json TEXT NOT NULL, command TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, delivered_at INTEGER, acknowledged_at INTEGER, completed_at INTEGER);
    CREATE TABLE tasks (task_id TEXT PRIMARY KEY, request_message_id TEXT NOT NULL, source_id TEXT NOT NULL, target_id TEXT NOT NULL, status TEXT NOT NULL, instruction TEXT, attempt INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE attempts (message_id TEXT NOT NULL, attempt INTEGER NOT NULL, target_id TEXT NOT NULL, status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (message_id, attempt));
    CREATE TABLE events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
    PRAGMA user_version = 1;
  `);
  legacy.close();

  const migrated = new BrokerStore(filename);
  assert.equal(migrated.getSchemaVersion(), BROKER_SCHEMA_VERSION);
  assert.deepEqual(migrated.snapshot().workflows, []);
  migrated.close();
  rmSync(directory, { recursive: true, force: true });
});

test('persists coding worktree integration state', () => {
  withStore((store) => {
    store.upsertWorktree({
      workflowId: 'workflow-1',
      taskId: 'code',
      owner: 'Builder',
      workspaceRoot: '/repo',
      worktreePath: '/repo/.git/starlight-worktrees/workflow-1-code',
      branch: 'starlight/workflow-1/code',
      baseCommit: 'abc123',
      declaredFiles: ['src/code.ts'],
      changedFiles: ['src/code.ts'],
      status: 'review',
      reviewApproved: false,
      sharedFilesApproved: false,
      createdAt: 100,
      updatedAt: 200,
    });
    const worktree = store.snapshot().worktrees[0] as any;
    assert.equal(worktree.branch, 'starlight/workflow-1/code');
    assert.deepEqual(worktree.changedFiles, ['src/code.ts']);
    assert.equal(store.snapshot().events.some((event) => event.eventType === 'worktree.updated'), true);
  });
});
