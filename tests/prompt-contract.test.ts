import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AGENT_PROMPT_VERSION,
  findCapabilityMismatch,
  generateAgentPromptContract,
  hasCapabilities,
} from '../src/services/promptContract.ts';
import { normalizeAgentMessage, StarlightEnvelopeParser } from '../src/services/brokerCore.ts';

const helper = fileURLToPath(new URL('../bin/lightfold-message.mjs', import.meta.url));
const legacyHelper = fileURLToPath(new URL('../bin/starlight-message.mjs', import.meta.url));

test('generates one identity-safe versioned prompt contract', () => {
  const prompt = generateAgentPromptContract({
    paneId: 'Dynamic-Pane-7',
    role: 'Test runner',
    allowedRoutes: ['Hub', 'Reviewer'],
    capabilities: ['Testing', 'general', 'testing'],
    tools: ['npm', 'git'],
    roleInstructions: 'Run the requested test suite.',
  });

  assert.equal(prompt, `# Lightfold Grid Agent Contract
Prompt version: ${AGENT_PROMPT_VERSION}
Agent ID: Dynamic-Pane-7
Role: Test runner
Allowed message targets: Hub, Reviewer
Capabilities: general, testing
Tools: git, npm

## Required Behavior
- Treat the physical Agent ID above as your identity. Never claim another sender identity.
- Only send messages to an allowed message target.
- On startup, announce readiness with the helper command below.
- For every assigned task, acknowledge before doing work.
- Report progress during long-running work.
- Finish with exactly one structured result, error, or cancel message.
- Repeated deliveries with the same message ID are retries; do not execute them twice.

## Message Helper
Use \`lightfold-message\` to emit protocol messages. Do not hand-write envelope markers or JSON.
Ready: \`lightfold-message ready --to broker --summary ready\`
Heartbeat: \`lightfold-message heartbeat --to broker --summary alive\`
Acknowledge: \`lightfold-message ack --to <sender> --task-id <task-id> --correlation-id <message-id> --summary accepted\`
Progress: \`lightfold-message progress --to <sender> --task-id <task-id> --correlation-id <message-id> --summary "status"\`
Result: \`lightfold-message result --to <sender> --task-id <task-id> --correlation-id <message-id> --summary "outcome" --artifact <path>\`
Error: \`lightfold-message error --to <sender> --task-id <task-id> --correlation-id <message-id> --summary "failure"\`

## Role Instructions
Run the requested test suite.`);
  assert.doesNotMatch(prompt, /\[\[STARLIGHT-MSG\]\]/);
  assert.doesNotMatch(prompt, /Pane-[A-Z]/);
});

test('message helper emits valid envelopes for every protocol kind', () => {
  const kinds = ['request', 'ack', 'progress', 'result', 'error', 'cancel', 'ready', 'heartbeat'] as const;
  for (const kind of kinds) {
    const args = [helper, kind, '--to', kind === 'ready' || kind === 'heartbeat' ? 'broker' : 'Hub', '--summary', kind];
    if (!['request', 'ready', 'heartbeat'].includes(kind)) args.push('--task-id', 'task-1', '--correlation-id', 'message-1');
    if (kind === 'request') args.push('--instruction', 'do work');
    if (kind === 'result') args.push('--artifact', 'result.log', '--data', '{"passed":true}');
    const output = execFileSync(process.execPath, args, { encoding: 'utf8' });
    const parsed = new StarlightEnvelopeParser().push('Physical-Agent', output);
    assert.equal(parsed.errors.length, 0);
    const normalized = normalizeAgentMessage(parsed.messages[0].envelope, { sourceId: 'Physical-Agent' });
    assert.equal(normalized.kind, kind);
    assert.equal(normalized.from, 'Physical-Agent');
  }
});

test('message helper rejects incomplete responses and capability checks are exact', () => {
  const failed = spawnSync(process.execPath, [helper, 'result', '--to', 'Hub'], { encoding: 'utf8' });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /--task-id is required/);
  assert.equal(hasCapabilities(['general', 'Testing'], ['testing']), true);
  assert.equal(hasCapabilities(['general'], ['coding']), false);
  const tasks = [
    { id: 'spec', owner: 'Writer', requiredCapabilities: ['specification'], requiredTools: ['markdown'] },
    { id: 'build', owner: 'Writer', requiredCapabilities: ['specification'], requiredTools: ['git'] },
  ];
  const mismatch = findCapabilityMismatch(tasks, [{
    agentId: 'Writer',
    capabilities: ['specification'],
    tools: ['markdown'],
  }]);
  assert.equal(mismatch?.id, 'build');
});

test('deprecated starlight-message alias emits the version-1 wire protocol', () => {
  const output = execFileSync(process.execPath, [legacyHelper, 'ready', '--to', 'broker', '--summary', 'ready'], {
    encoding: 'utf8',
  });
  assert.match(output, /^\[\[STARLIGHT-MSG\]\]/);
  const parsed = new StarlightEnvelopeParser().push('Legacy-Agent', output);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.messages[0].envelope.kind, 'ready');
});
