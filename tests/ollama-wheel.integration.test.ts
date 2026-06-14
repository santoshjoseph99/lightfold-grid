import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isRouteAllowed,
  normalizeAgentMessage,
  STARLIGHT_END_TAG,
  STARLIGHT_START_TAG,
  StarlightEnvelopeParser,
} from '../src/services/brokerCore.ts';

const enabled = process.env.LIGHTFOLD_GRID_OLLAMA_TEST === '1' || process.env.STARLIGHT_OLLAMA_TEST === '1';
const model = process.env.LIGHTFOLD_GRID_OLLAMA_MODEL || process.env.STARLIGHT_OLLAMA_MODEL || 'gemma4-32k:latest';

test('local Ollama spokes emit routable response envelopes to the hub', { skip: !enabled, timeout: 120_000 }, async () => {
  const parser = new StarlightEnvelopeParser();
  const spokes = ['Spoke-A', 'Spoke-B', 'Spoke-C'];
  const connections = {
    Hub: spokes,
    'Spoke-A': ['Hub'],
    'Spoke-B': ['Hub'],
    'Spoke-C': ['Hub'],
  };
  const received: string[] = [];

  for (const spoke of spokes) {
    const command = `${spoke.toLowerCase()}-ready`;
    const prompt = `You are ${spoke} in a Lightfold Grid wheel network.
Reply with exactly one line and no markdown:
${STARLIGHT_START_TAG}{"from":"${spoke}","to":"Hub","command":"${command}","type":"result"}${STARLIGHT_END_TAG}`;

    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        think: false,
        options: { temperature: 0 },
      }),
    });
    assert.equal(response.ok, true, `Ollama API returned ${response.status}`);
    const payload = await response.json() as { response: string };
    const result = parser.push(spoke, payload.response);

    assert.equal(result.messages.length, 1, `Expected one Lightfold Grid envelope in ${spoke} output:\n${payload.response}`);
    const normalized = normalizeAgentMessage(result.messages[0].envelope, { sourceId: spoke });
    assert.equal(normalized.from, spoke);
    assert.equal(isRouteAllowed(connections, normalized.from, normalized.to), true);
    received.push(normalized.payload.instruction!);
  }

  assert.deepEqual(received, ['spoke-a-ready', 'spoke-b-ready', 'spoke-c-ready']);
});
