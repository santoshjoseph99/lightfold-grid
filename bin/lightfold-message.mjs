#!/usr/bin/env node

const kinds = new Set(['request', 'ack', 'progress', 'result', 'error', 'cancel', 'ready', 'heartbeat']);
const args = process.argv.slice(2);
const kind = args.shift();

const fail = (message) => {
  process.stderr.write(`lightfold-message: ${message}\n`);
  process.exit(1);
};

if (!kind || !kinds.has(kind)) fail(`kind must be one of: ${[...kinds].join(', ')}`);

const values = {};
const artifacts = [];
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (!argument.startsWith('--')) fail(`unexpected argument ${argument}`);
  const key = argument.slice(2);
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${argument} requires a value`);
  index += 1;
  if (key === 'artifact') artifacts.push(value);
  else values[key] = value;
}

if (!values.to) fail('--to is required');
if (!['request', 'ready', 'heartbeat'].includes(kind) && !values['task-id']) fail('--task-id is required');

let data;
if (values.data) {
  try {
    data = JSON.parse(values.data);
  } catch {
    fail('--data must contain valid JSON');
  }
}

const envelope = {
  protocolVersion: 1,
  ...(values['task-id'] ? { taskId: values['task-id'] } : {}),
  ...(values['parent-task-id'] ? { parentTaskId: values['parent-task-id'] } : {}),
  ...(values['correlation-id'] ? { correlationId: values['correlation-id'] } : {}),
  to: values.to,
  kind,
  payload: {
    ...(values.instruction ? { instruction: values.instruction } : {}),
    ...(values.summary ? { summary: values.summary } : {}),
    ...(artifacts.length > 0 ? { artifacts } : {}),
    ...(data !== undefined ? { data } : {}),
  },
  attempt: values.attempt ? Number(values.attempt) : 1,
};

if (!Number.isInteger(envelope.attempt) || envelope.attempt < 1) fail('--attempt must be a positive integer');

// The legacy marker is the stable version-1 wire protocol, not the product name.
process.stdout.write(`[[STARLIGHT-MSG]]${JSON.stringify(envelope)}[[END]]\n`);
