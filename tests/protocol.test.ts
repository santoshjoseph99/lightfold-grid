import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_PROTOCOL_VERSION,
  BoundedMessageHistory,
  normalizeAgentMessage,
  ProtocolValidationError,
} from '../src/services/brokerCore.ts';

const ids = (...values: string[]) => {
  const queue = [...values];
  return () => queue.shift() || 'unexpected-id';
};

test('normalizes legacy envelopes into the versioned protocol', () => {
  const message = normalizeAgentMessage(
    {
      from: 'Impersonated-Pane',
      to: 'Pane-B',
      command: 'inspect the tests',
      type: 'task',
    },
    {
      sourceId: 'Pane-A',
      createId: ids('message-1', 'task-1'),
      now: () => 1234,
    }
  );

  assert.deepEqual(message, {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    messageId: 'message-1',
    taskId: 'task-1',
    from: 'Pane-A',
    to: 'Pane-B',
    kind: 'request',
    payload: {
      instruction: 'inspect the tests',
      data: { legacy: true, legacyType: 'task' },
    },
    attempt: 1,
    timestamp: 1234,
  });
});

test('assigns broker IDs to requests and preserves correlation fields on responses', () => {
  const request = normalizeAgentMessage(
    {
      protocolVersion: 1,
      messageId: 'agent-selected-message-id',
      taskId: 'agent-selected-task-id',
      from: 'Impersonated-Pane',
      to: 'Pane-B',
      kind: 'request',
      payload: { instruction: 'run tests' },
      attempt: 3,
    },
    {
      sourceId: 'Pane-A',
      createId: ids('broker-message-id', 'broker-task-id'),
      now: () => 2000,
    }
  );

  assert.equal(request.messageId, 'broker-message-id');
  assert.equal(request.taskId, 'broker-task-id');
  assert.equal(request.from, 'Pane-A');
  assert.equal(request.attempt, 1);

  const result = normalizeAgentMessage(
    {
      protocolVersion: 1,
      taskId: request.taskId,
      correlationId: request.messageId,
      to: 'Pane-A',
      kind: 'result',
      payload: { summary: 'tests passed', artifacts: ['test.log'] },
    },
    {
      sourceId: 'Pane-B',
      createId: ids('result-message-id'),
      now: () => 3000,
    }
  );

  assert.equal(result.taskId, request.taskId);
  assert.equal(result.correlationId, request.messageId);
  assert.equal(result.messageId, 'result-message-id');
  assert.equal(result.from, 'Pane-B');
});

test('rejects malformed, unsupported, and incomplete protocol messages', () => {
  assert.throws(
    () => normalizeAgentMessage('not-an-object', { sourceId: 'Pane-A' }),
    (error) => error instanceof ProtocolValidationError && error.code === 'INVALID_ENVELOPE'
  );
  assert.throws(
    () => normalizeAgentMessage({ protocolVersion: 99 }, { sourceId: 'Pane-A' }),
    (error) => error instanceof ProtocolValidationError && error.code === 'UNSUPPORTED_VERSION'
  );
  assert.throws(
    () => normalizeAgentMessage(
      { protocolVersion: 1, to: 'Pane-A', kind: 'result', payload: { summary: 'done' } },
      { sourceId: 'Pane-B' }
    ),
    (error) => error instanceof ProtocolValidationError && error.code === 'MISSING_TASK_ID'
  );
  assert.throws(
    () => normalizeAgentMessage(
      { protocolVersion: 1, taskId: 'task-1', to: 'Pane-A', kind: 'result', payload: [] },
      { sourceId: 'Pane-B' }
    ),
    (error) => error instanceof ProtocolValidationError && error.code === 'INVALID_PAYLOAD'
  );
});

test('bounded history drops oldest messages and replaces records immutably', () => {
  const history = new BoundedMessageHistory<{ messageId: string; status: string }>(2);
  const original = { messageId: 'm1', status: 'pending' };
  history.append(original);
  history.append({ messageId: 'm2', status: 'pending' });

  const updated = history.update('m1', (message) => ({ ...message, status: 'completed' }));
  history.append({ messageId: 'm3', status: 'pending' });

  assert.notEqual(updated, original);
  assert.equal(original.status, 'pending');
  assert.deepEqual(history.values(), [
    { messageId: 'm2', status: 'pending' },
    { messageId: 'm3', status: 'pending' },
  ]);
});
