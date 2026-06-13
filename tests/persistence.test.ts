import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
