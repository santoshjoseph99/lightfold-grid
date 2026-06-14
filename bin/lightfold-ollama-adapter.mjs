#!/usr/bin/env node

import readline from 'node:readline';

const args = process.argv.slice(2);
const valueFor = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const model = valueFor('--model', process.env.LIGHTFOLD_GRID_OLLAMA_MODEL || 'gemma4-32k:latest');
const host = valueFor('--host', process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
const marker = (kind, summary, fields = {}) => `[[STARLIGHT-MSG]]${JSON.stringify({
  protocolVersion: 1,
  to: 'broker',
  kind,
  payload: { summary },
  attempt: 1,
  ...fields,
})}[[END]]`;
const parseRequest = (prompt) => {
  const match = prompt.match(/\[\[STARLIGHT-MSG\]\](.*?)\[\[END\]\]/s);
  if (!match) return undefined;
  try {
    const envelope = JSON.parse(match[1]);
    return envelope.kind === 'request' && envelope.taskId && envelope.messageId ? envelope : undefined;
  } catch {
    return undefined;
  }
};

process.stdout.write(`${marker('ready', `Ollama adapter ready: ${model}`)}\n`);
const heartbeat = setInterval(() => process.stdout.write(`${marker('heartbeat', 'Ollama adapter alive')}\n`), 15_000);
heartbeat.unref();

const input = readline.createInterface({ input: process.stdin, terminal: false });
let pending = Promise.resolve();
let pastedPrompt = '';
const messages = [];
const submit = (raw) => {
  const prompt = raw.replaceAll('\u001b[200~', '').replaceAll('\u001b[201~', '').trim();
  if (!prompt) return;
  pending = pending.then(async () => {
    const request = parseRequest(prompt);
    try {
      if (request) {
        process.stdout.write(`${marker('ack', 'accepted', {
          to: request.from,
          taskId: request.taskId,
          correlationId: request.messageId,
        })}\n`);
      }
      messages.push({ role: 'user', content: prompt });
      const response = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false }),
      });
      if (!response.ok) throw new Error(`Ollama API returned ${response.status}`);
      const result = await response.json();
      const content = result.message?.content || '';
      messages.push({ role: 'assistant', content });
      const safeContent = content
        .replaceAll('[[STARLIGHT-MSG]]', '[[MODEL-MSG]]')
        .replaceAll('[[END]]', '[[MODEL-END]]');
      process.stdout.write(`${safeContent}\n`);
      if (request) {
        process.stdout.write(`${marker('result', safeContent || 'Ollama completed the request.', {
          to: request.from,
          taskId: request.taskId,
          correlationId: request.messageId,
        })}\n`);
      }
    } catch (error) {
      const summary = `Lightfold Ollama adapter error: ${error instanceof Error ? error.message : String(error)}`;
      process.stderr.write(`${summary}\n`);
      if (request) {
        process.stdout.write(`${marker('error', summary, {
          to: request.from,
          taskId: request.taskId,
          correlationId: request.messageId,
        })}\n`);
      }
    }
  });
};
input.on('line', (line) => {
  if (pastedPrompt || line.includes('\u001b[200~')) {
    pastedPrompt += `${line}\n`;
    if (line.includes('\u001b[201~')) {
      submit(pastedPrompt);
      pastedPrompt = '';
    }
    return;
  }
  submit(line);
});

const shutdown = () => {
  clearInterval(heartbeat);
  input.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
