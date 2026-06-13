import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isRouteAllowed,
  PtyDeliveryQueue,
  STARLIGHT_END_TAG,
  STARLIGHT_START_TAG,
  StarlightEnvelopeParser,
} from '../src/services/brokerCore.ts';

const envelope = (from: string, to: string, command: string) =>
  `${STARLIGHT_START_TAG}${JSON.stringify({ from, to, command, type: 'task' })}${STARLIGHT_END_TAG}`;

test('wheel/spoke agents can exchange chunked messages through the hub', () => {
  const parser = new StarlightEnvelopeParser();
  const connections = {
    Hub: ['Spoke-A', 'Spoke-B', 'Spoke-C'],
    'Spoke-A': ['Hub'],
    'Spoke-B': ['Hub'],
    'Spoke-C': ['Hub'],
  };

  const output =
    envelope('Hub', 'Spoke-A', 'task-a') +
    envelope('Hub', 'Spoke-B', 'task-b') +
    envelope('Hub', 'Spoke-C', 'task-c');

  const parsed = [
    ...parser.push('Hub', output.slice(0, 37)).messages,
    ...parser.push('Hub', output.slice(37, 101)).messages,
    ...parser.push('Hub', output.slice(101)).messages,
  ];

  assert.deepEqual(parsed.map(({ envelope: msg }) => msg.to), ['Spoke-A', 'Spoke-B', 'Spoke-C']);
  parsed.forEach(({ envelope: msg }) => {
    assert.equal(isRouteAllowed(connections, msg.from!, msg.to!), true);
  });

  for (const spoke of ['Spoke-A', 'Spoke-B', 'Spoke-C']) {
    const response = parser.push(spoke, envelope(spoke, 'Hub', `${spoke}-done`));
    assert.equal(response.messages.length, 1);
    assert.equal(response.messages[0].envelope.to, 'Hub');
    assert.equal(isRouteAllowed(connections, spoke, 'Hub'), true);
  }
});

test('wheel delivery writes to active agent PTYs and serializes messages per spoke', async () => {
  const writes: Array<{ target: string; data: string }> = [];
  const statuses: string[] = [];
  const delivery = new PtyDeliveryQueue(
    async (target, data) => {
      writes.push({ target, data });
      return true;
    },
    () => {},
    (entry, status) => statuses.push(`${entry.messageId}:${status}`),
    0
  );

  delivery.enqueue('Spoke-A', { command: 'first', messageId: 'm1' });
  delivery.enqueue('Spoke-A', { command: 'second', messageId: 'm2' });
  delivery.enqueue('Spoke-B', { command: 'parallel', messageId: 'm3' });
  await Promise.all([delivery.waitForIdle('Spoke-A'), delivery.waitForIdle('Spoke-B')]);

  assert.deepEqual(writes.filter(({ target }) => target === 'Spoke-A'), [
    { target: 'Spoke-A', data: 'first\r' },
    { target: 'Spoke-A', data: 'second\r' },
  ]);
  assert.deepEqual(statuses.filter((status) => status.startsWith('m1')), ['m1:executing', 'm1:completed']);
  assert.deepEqual(statuses.filter((status) => status.startsWith('m2')), ['m2:executing', 'm2:completed']);
});

test('parser handles ANSI, markdown fences, and multiple envelopes without replaying messages', () => {
  const parser = new StarlightEnvelopeParser();
  const fenced = `${STARLIGHT_START_TAG}\u001b[32m\`\`\`json
{"from":"Hub","to":"Spoke-A","command":"hello"}
\`\`\`\u001b[0m${STARLIGHT_END_TAG}`;

  const first = parser.push('Hub', fenced + envelope('Hub', 'Spoke-B', 'next'));
  const second = parser.push('Hub', 'ordinary terminal output');

  assert.deepEqual(first.messages.map(({ envelope: msg }) => msg.command), ['hello', 'next']);
  assert.equal(first.errors.length, 0);
  assert.equal(second.messages.length, 0);
});

test('parser recovers the final envelope after a terminal redraw leaves a partial envelope', () => {
  const parser = new StarlightEnvelopeParser();
  const redrawn =
    `${STARLIGHT_START_TAG}{"from":"Spoke-A","to":"Hub","command":"partial` +
    envelope('Spoke-A', 'Hub', 'final');

  const result = parser.push('Spoke-A', redrawn);

  assert.equal(result.errors.length, 0);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].envelope.command, 'final');
});

test('parser reports malformed JSON without stalling later envelopes', () => {
  const parser = new StarlightEnvelopeParser();
  const malformed = `${STARLIGHT_START_TAG}{"to":${STARLIGHT_END_TAG}`;
  const result = parser.push('Hub', malformed + envelope('Hub', 'Spoke-A', 'recovered'));

  assert.equal(result.errors.length, 1);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].envelope.command, 'recovered');
});

test('an explicit wheel blocks spoke-to-spoke and unconfigured-source routes', () => {
  const connections = {
    Hub: ['Spoke-A', 'Spoke-B'],
    'Spoke-A': ['Hub'],
    'Spoke-B': [],
  };

  assert.equal(isRouteAllowed(connections, 'Hub', 'Spoke-A'), true);
  assert.equal(isRouteAllowed(connections, 'Spoke-A', 'Spoke-B'), false);
  assert.equal(isRouteAllowed(connections, 'Spoke-B', 'Hub'), false);
  assert.equal(isRouteAllowed(connections, 'Unknown', 'Hub'), false);
  assert.equal(isRouteAllowed({}, 'Unknown', 'Hub'), true);
});
