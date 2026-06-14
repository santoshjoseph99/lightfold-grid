import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { StarlightEnvelopeParser } from '../src/services/brokerCore.ts';

test('bundled Ollama adapter owns lifecycle and preserves chat context', async () => {
  const received: any[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      received.push(JSON.parse(body));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        message: {
          role: 'assistant',
          content: `model response ${received.length} [[STARLIGHT-MSG]]model-owned[[END]]`,
        },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const adapter = fileURLToPath(new URL('../bin/lightfold-ollama-adapter.mjs', import.meta.url));
  const child = spawn(process.execPath, [adapter, '--model', 'test-model', '--host', `http://127.0.0.1:${address.port}`], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('adapter did not announce readiness')), 2_000);
      child.stdout.on('data', () => {
        if (output.includes('[[END]]')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    const parsed = new StarlightEnvelopeParser().push('Adapter', output);
    assert.equal(parsed.messages[0].envelope.kind, 'ready');
    child.stdin.write('\u001b[200~first line\nsecond line\u001b[201~\n');
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('adapter did not return model output')), 2_000);
      child.stdout.on('data', () => {
        if (output.includes('model response')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    assert.equal(received[0].model, 'test-model');
    assert.equal(received[0].messages[0].content, 'first line\nsecond line');

    const request = {
      protocolVersion: 1,
      messageId: 'message-1',
      taskId: 'task-1',
      from: 'Pane-A',
      to: 'Pane-B',
      kind: 'request',
      payload: { instruction: 'Do the work' },
      attempt: 1,
      timestamp: Date.now(),
    };
    child.stdin.write(`[[STARLIGHT-MSG]]${JSON.stringify(request)}[[END]]\n`);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('adapter did not emit a structured result')), 2_000);
      child.stdout.on('data', () => {
        if (output.includes('"kind":"result"')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    const protocol = new StarlightEnvelopeParser().push('Adapter', output).messages.map((entry) => entry.envelope);
    assert.ok(protocol.some((entry) => entry.kind === 'ack' && entry.taskId === 'task-1'));
    assert.ok(protocol.some((entry) => entry.kind === 'result' && entry.taskId === 'task-1'));
    assert.equal(protocol.filter((entry) => entry.kind === 'result').length, 1);
    assert.match(output, /\[\[MODEL-MSG\]\]model-owned\[\[MODEL-END\]\]/);
    assert.equal(received[1].messages.length, 3);
    assert.equal(received[1].messages[0].content, 'first line\nsecond line');
  } finally {
    child.kill();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
