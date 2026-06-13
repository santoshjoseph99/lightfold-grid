import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ReliableRequestManager,
} from '../src/services/brokerCore.ts';
import type {
  AgentMessage,
  ReliabilityScheduler,
  ReliableRequestStatus,
} from '../src/services/brokerCore.ts';

class ManualScheduler implements ReliabilityScheduler {
  private nextId = 1;
  private now = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();

  schedule(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + delayMs, callback });
    return id;
  }

  cancel(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(ms: number) {
    this.now += ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= this.now)
        .sort((a, b) => a[1].at - b[1].at);
      if (due.length === 0) break;
      for (const [id, timer] of due) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }

  time = () => this.now;
}

const request = (overrides: Partial<AgentMessage> = {}): AgentMessage => ({
  protocolVersion: 1,
  messageId: 'request-1',
  taskId: 'task-1',
  from: 'Hub',
  to: 'Spoke-A',
  kind: 'request',
  payload: { instruction: 'inspect tests' },
  attempt: 1,
  timestamp: 0,
  ...overrides,
});

const response = (
  kind: AgentMessage['kind'],
  overrides: Partial<AgentMessage> = {}
): AgentMessage => ({
  protocolVersion: 1,
  messageId: `${kind}-1`,
  taskId: 'task-1',
  correlationId: 'request-1',
  from: 'Spoke-A',
  to: 'Hub',
  kind,
  payload: { summary: kind },
  attempt: 1,
  timestamp: 0,
  ...overrides,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('tracks delivered, acknowledged, and completed as separate states', async () => {
  const scheduler = new ManualScheduler();
  const states: ReliableRequestStatus[] = [];
  const writes: string[] = [];
  const manager = new ReliableRequestManager(
    async (_target, data) => {
      writes.push(data);
      return true;
    },
    (record) => states.push(record.status),
    scheduler,
    { acknowledgementTimeoutMs: 10, completionTimeoutMs: 20 },
    scheduler.time
  );

  assert.equal(manager.submit(request()), true);
  await flush();
  assert.match(writes[0], /Message ID: request-1/);
  assert.doesNotMatch(writes[0], /\[\[STARLIGHT-MSG\]\]/);
  assert.equal(manager.get('request-1')?.status, 'delivered');

  assert.equal(manager.handleResponse(response('ack')), 'accepted');
  assert.equal(manager.get('request-1')?.status, 'acknowledged');
  assert.equal(manager.handleResponse(response('result')), 'accepted');
  assert.equal(manager.get('request-1')?.status, 'completed');
  assert.deepEqual(states, ['queued', 'delivering', 'delivered', 'acknowledged', 'completed']);
});

test('retries unacknowledged requests with stable IDs and increasing attempts', async () => {
  const scheduler = new ManualScheduler();
  const writes: string[] = [];
  const manager = new ReliableRequestManager(
    async (_target, data) => {
      writes.push(data);
      return true;
    },
    () => {},
    scheduler,
    { acknowledgementTimeoutMs: 10, retryBaseDelayMs: 5, maxAttempts: 3 },
    scheduler.time
  );

  manager.submit(request());
  assert.equal(manager.submit(request()), false);
  await flush();
  scheduler.advance(10);
  scheduler.advance(5);
  await flush();

  assert.equal(writes.length, 2);
  assert.match(writes[0], /Message ID: request-1/);
  assert.match(writes[1], /Message ID: request-1/);
  assert.match(writes[1], /Attempt: 2/);
  assert.equal(manager.get('request-1')?.attempt, 2);

  assert.equal(manager.handleResponse(response('ack')), 'accepted');
  scheduler.advance(100);
  await flush();
  assert.equal(writes.length, 2);
  assert.equal(manager.get('request-1')?.status, 'acknowledged');
});

test('moves exhausted and completion-timed-out requests to dead letters', async () => {
  const scheduler = new ManualScheduler();
  const manager = new ReliableRequestManager(
    async () => true,
    () => {},
    scheduler,
    {
      acknowledgementTimeoutMs: 10,
      completionTimeoutMs: 20,
      retryBaseDelayMs: 1,
      maxAttempts: 1,
    },
    scheduler.time
  );

  manager.submit(request());
  await flush();
  scheduler.advance(10);
  assert.equal(manager.get('request-1')?.status, 'failed');
  assert.equal(manager.getDeadLetters().length, 1);

  assert.equal(manager.retry('request-1'), true);
  await flush();
  manager.handleResponse(response('ack'));
  scheduler.advance(20);
  assert.equal(manager.get('request-1')?.status, 'failed');
  assert.equal(manager.get('request-1')?.error, 'Task completion timeout.');

  assert.equal(manager.retry('request-1'), true);
  await flush();
  assert.equal(manager.handleResponse(response('ack', { messageId: 'ack-after-retry' })), 'accepted');
  assert.equal(manager.get('request-1')?.status, 'acknowledged');
});

test('uses exponential backoff and dead-letters permanent delivery failures', async () => {
  const scheduler = new ManualScheduler();
  let writes = 0;
  const manager = new ReliableRequestManager(
    async () => {
      writes += 1;
      return false;
    },
    () => {},
    scheduler,
    { retryBaseDelayMs: 5, maxAttempts: 3 },
    scheduler.time
  );

  manager.submit(request());
  await flush();
  assert.equal(writes, 1);

  scheduler.advance(5);
  await flush();
  assert.equal(writes, 2);
  scheduler.advance(9);
  await flush();
  assert.equal(writes, 2);
  scheduler.advance(1);
  await flush();

  assert.equal(writes, 3);
  assert.equal(manager.get('request-1')?.status, 'failed');
  assert.equal(manager.getDeadLetters()[0].attempt, 3);
});

test('deduplicates responses and ignores responses from the wrong agent', async () => {
  const scheduler = new ManualScheduler();
  const manager = new ReliableRequestManager(async () => true, () => {}, scheduler, {}, scheduler.time);
  manager.submit(request());
  await flush();

  assert.equal(manager.handleResponse(response('ack', { from: 'Spoke-B' })), 'unmatched');
  assert.equal(manager.handleResponse(response('ack', { to: 'Another-Hub' })), 'unmatched');
  assert.equal(manager.get('request-1')?.status, 'delivered');
  assert.equal(manager.handleResponse(response('ack')), 'accepted');
  assert.equal(manager.handleResponse(response('ack', { messageId: 'ack-duplicate' })), 'duplicate');
});

test('supports cancellation, manual retry, and reassignment', async () => {
  const scheduler = new ManualScheduler();
  const targets: string[] = [];
  const manager = new ReliableRequestManager(
    async (target) => {
      targets.push(target);
      return true;
    },
    () => {},
    scheduler,
    { maxAttempts: 1 },
    scheduler.time
  );

  manager.submit(request());
  await flush();
  assert.equal(manager.cancel('request-1'), true);
  assert.equal(manager.get('request-1')?.status, 'cancelled');
  assert.equal(manager.reassign('request-1', 'Spoke-B'), true);
  await flush();
  assert.equal(manager.get('request-1')?.message.to, 'Spoke-B');
  assert.deepEqual(targets, ['Spoke-A', 'Spoke-B']);
});

test('validates runtime reliability configuration', () => {
  const manager = new ReliableRequestManager(async () => true);
  assert.throws(() => manager.configure({ maxAttempts: 0 }), /positive integer/);
  manager.configure({ acknowledgementTimeoutMs: 25, maxAttempts: 4 });
  assert.equal(manager.getOptions().acknowledgementTimeoutMs, 25);
  assert.equal(manager.getOptions().maxAttempts, 4);
});
