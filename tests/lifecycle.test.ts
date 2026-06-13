import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentLifecycleManager,
  ReliableRequestManager,
} from '../src/services/brokerCore.ts';
import type { AgentMessage, AgentLifecycleState } from '../src/services/brokerCore.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const request = (overrides: Partial<AgentMessage> = {}): AgentMessage => ({
  protocolVersion: 1,
  messageId: 'message-1',
  taskId: 'task-1',
  from: 'Hub',
  to: 'Spoke-A',
  kind: 'request',
  payload: { instruction: 'do work' },
  attempt: 1,
  timestamp: 0,
  ...overrides,
});

test('tracks startup, readiness, busy work, completion, and shutdown', () => {
  const states: AgentLifecycleState[] = [];
  const lifecycle = new AgentLifecycleManager((record) => states.push(record.state));

  lifecycle.register('Spoke-A');
  lifecycle.starting('Spoke-A');
  assert.equal(lifecycle.canAcceptTask('Spoke-A'), false);
  lifecycle.ready('Spoke-A');
  assert.equal(lifecycle.canAcceptTask('Spoke-A'), true);
  lifecycle.taskStarted('Spoke-A', 'task-1');
  assert.equal(lifecycle.get('Spoke-A')?.currentTaskId, 'task-1');
  assert.equal(lifecycle.canAcceptTask('Spoke-A'), false);
  lifecycle.taskFinished('Spoke-A');
  lifecycle.stopping('Spoke-A');
  lifecycle.stopped('Spoke-A');

  assert.deepEqual(states, ['stopped', 'starting', 'ready', 'busy', 'ready', 'stopping', 'stopped']);
});

test('tracks the configured agent contract with lifecycle state', () => {
  const lifecycle = new AgentLifecycleManager();
  lifecycle.register('Spoke-A', {
    role: 'Builder',
    capabilities: ['coding', 'testing'],
    tools: ['git', 'npm'],
    promptVersion: 1,
  });
  lifecycle.ready('Spoke-A');
  assert.deepEqual(lifecycle.get('Spoke-A'), {
    agentId: 'Spoke-A',
    state: 'ready',
    role: 'Builder',
    capabilities: ['coding', 'testing'],
    tools: ['git', 'npm'],
    promptVersion: 1,
    currentTaskId: undefined,
    error: undefined,
    lastHeartbeatAt: lifecycle.get('Spoke-A')?.lastHeartbeatAt,
  });
});

test('detects heartbeat timeouts and recovers on heartbeat', () => {
  let now = 0;
  const lifecycle = new AgentLifecycleManager(() => {}, { heartbeatTimeoutMs: 10 }, () => now);
  lifecycle.ready('Spoke-A');
  now = 11;
  lifecycle.checkHealth();
  assert.equal(lifecycle.get('Spoke-A')?.state, 'unresponsive');
  now = 12;
  lifecycle.heartbeat('Spoke-A');
  assert.equal(lifecycle.get('Spoke-A')?.state, 'ready');
});

test('queues a request until target readiness and serializes one active task per agent', async () => {
  const writes: string[] = [];
  const scheduled: Array<() => void> = [];
  const lifecycle = new AgentLifecycleManager();
  lifecycle.starting('Spoke-A');
  const requests = new ReliableRequestManager(
    async (_target, data) => {
      writes.push(data);
      return true;
    },
    () => {},
    {
      schedule: (callback) => {
        scheduled.push(callback);
        return callback;
      },
      cancel: () => {},
    },
    {},
    Date.now,
    {
      canDeliver: (target) => lifecycle.canAcceptTask(target),
      onTaskStarted: (target, taskId) => lifecycle.taskStarted(target, taskId),
    }
  );

  requests.submit(request());
  requests.submit(request({ messageId: 'message-2', taskId: 'task-2' }));
  requests.submit(request({ messageId: 'message-3', taskId: 'task-3' }));
  await flush();
  assert.equal(writes.length, 0);

  lifecycle.ready('Spoke-A');
  requests.wakeTarget('Spoke-A');
  await flush();
  assert.equal(writes.length, 1);
  assert.equal(lifecycle.get('Spoke-A')?.currentTaskId, 'task-1');
  requests.cancel('message-3');
  lifecycle.taskFinished('Spoke-A', 'task-3');
  assert.equal(lifecycle.get('Spoke-A')?.currentTaskId, 'task-1');

  lifecycle.taskFinished('Spoke-A');
  requests.wakeTarget('Spoke-A');
  await flush();
  assert.equal(writes.length, 2);
  assert.equal(lifecycle.get('Spoke-A')?.currentTaskId, 'task-2');
});

test('fails active work for reassignment and supports restart readiness', async () => {
  const writes: string[] = [];
  const lifecycle = new AgentLifecycleManager();
  const requests = new ReliableRequestManager(async (_target, data) => {
    writes.push(data);
    return true;
  }, () => {}, {
    schedule: (callback) => callback,
    cancel: () => {},
  }, {}, Date.now, {
    canDeliver: (target) => lifecycle.canAcceptTask(target),
    onTaskStarted: (target, taskId) => lifecycle.taskStarted(target, taskId),
  });

  lifecycle.ready('Spoke-A');
  requests.submit(request());
  await flush();
  assert.equal(writes.length, 1);

  requests.failTarget('Spoke-A', 'PTY exited');
  lifecycle.failed('Spoke-A', 'PTY exited');
  assert.equal(requests.get('message-1')?.status, 'failed');
  assert.equal(requests.reassign('message-1', 'Spoke-B'), true);
  assert.equal(lifecycle.get('Spoke-A')?.state, 'failed');
  assert.equal(lifecycle.canAcceptTask('Spoke-A'), false);
  lifecycle.starting('Spoke-A');
  lifecycle.ready('Spoke-A');
  assert.equal(lifecycle.canAcceptTask('Spoke-A'), true);
});
