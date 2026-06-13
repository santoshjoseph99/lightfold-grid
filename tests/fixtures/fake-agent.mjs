#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import readline from 'node:readline';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=') || 'true'];
}));
const id = args.id || 'Agent';
const delay = Number(args['ready-delay'] || 0);
const marker = args.marker;
const envelope = (kind, to, taskId, correlationId, summary) =>
  `[[STARLIGHT-MSG]]${JSON.stringify({
    protocolVersion: 1,
    to,
    kind,
    taskId,
    correlationId,
    payload: { summary },
    attempt: 1,
  })}[[END]]`;
const send = (kind, to, taskId, correlationId, summary) =>
  process.stdout.write(`${envelope(kind, to, taskId, correlationId, summary)}\n`);
const markOnce = (suffix) => {
  if (!marker) return true;
  const path = `${marker}.${suffix}`;
  if (existsSync(path)) return false;
  writeFileSync(path, 'done\n');
  return true;
};

if (args.malformed === 'true') process.stdout.write('[[STARLIGHT-MSG]]{"broken":[[END]]\n');
setTimeout(() => send('ready', 'broker', undefined, undefined, `${id} ready`), delay);

let task = null;
readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  const clean = line.replace(/\r/g, '');
  if (clean === '[STARLIGHT TASK]') task = {};
  else if (task && clean.startsWith('Task ID: ')) task.taskId = clean.slice(9);
  else if (task && clean.startsWith('Message ID: ')) task.messageId = clean.slice(12);
  else if (task && clean.startsWith('Attempt: ')) task.attempt = Number(clean.slice(9));
  else if (task?.instructionNext) {
    task.instruction = clean;
    handle(task);
    task = null;
  } else if (task && clean === 'Instruction:') task.instructionNext = true;
});

function handle(current) {
  if (args.crash === 'true' && markOnce('crash')) process.exit(23);
  const dropAck = args['drop-ack'] === 'true' && markOnce('drop-ack');
  if (!dropAck) send('ack', 'Hub', current.taskId, current.messageId, 'accepted');
  if (dropAck) return;
  if (current.instruction.startsWith('STARLIGHT_CODE ')) {
    const action = JSON.parse(current.instruction.slice('STARLIGHT_CODE '.length));
    writeFileSync(`${action.cwd}/${action.file}`, action.content);
    execFileSync('git', ['add', action.file], { cwd: action.cwd });
    execFileSync('git', ['commit', '-m', action.commit], { cwd: action.cwd });
  }
  setTimeout(() => send('result', 'Hub', current.taskId, current.messageId, `${id} completed`), Number(args['result-delay'] || 10));
}
