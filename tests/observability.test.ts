import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDiagnosticBundle, redactDiagnostics, runWorkspaceHealthChecks } from '../electron/diagnostics.ts';
import {
  calculateBrokerMetrics,
  getCorrelatedMessageChain,
  getWorkflowTimeline,
} from '../src/services/observability.ts';
import type { StarlightMessage } from '../src/services/brokerProtocol.ts';

const message = (overrides: Partial<StarlightMessage> = {}): StarlightMessage => ({
  protocolVersion: 1,
  messageId: 'request-1',
  id: 'request-1',
  taskId: 'task-1',
  from: 'Hub',
  to: 'Builder',
  kind: 'request',
  payload: { instruction: 'work' },
  attempt: 2,
  timestamp: 100,
  command: 'work',
  type: 'request',
  status: 'completed',
  deliveredAt: 150,
  acknowledgedAt: 175,
  completedAt: 275,
  ...overrides,
});

test('calculates operational metrics and correlated request chains', () => {
  const request = message();
  const ack = message({
    messageId: 'ack-1',
    id: 'ack-1',
    correlationId: request.messageId,
    kind: 'ack',
    from: 'Builder',
    to: 'Hub',
    attempt: 1,
    status: 'completed',
    timestamp: 180,
  });
  const snapshot = {
    agents: [
      { agentId: 'Hub', state: 'ready' as const },
      { agentId: 'Builder', state: 'failed' as const },
    ],
    messages: [request, ack, message({
      messageId: 'queued',
      id: 'queued',
      taskId: 'task-2',
      status: 'queued',
      attempt: 1,
      deliveredAt: undefined,
      acknowledgedAt: undefined,
      completedAt: undefined,
    })],
    workflows: [{ id: 'wf', name: 'wf', goal: 'wf', createdBy: 'Hub', status: 'failed' as const, createdAt: 1, updatedAt: 2, tasks: [] }],
    events: [],
  };

  assert.deepEqual(calculateBrokerMetrics(snapshot), {
    queueDepth: 1,
    averageDeliveryLatencyMs: 50,
    averageTaskDurationMs: 100,
    retries: 1,
    failures: 1,
    agentUptimePercent: 50,
  });
  assert.deepEqual(getCorrelatedMessageChain(snapshot.messages, ack).map((item) => item.messageId), ['request-1', 'ack-1']);
});

test('filters a workflow timeline using workflow, task, and message identities', () => {
  const workflow = {
    id: 'wf',
    name: 'workflow',
    goal: 'work',
    createdBy: 'Hub',
    status: 'running' as const,
    createdAt: 1,
    updatedAt: 2,
    tasks: [{
      workflowId: 'wf',
      id: 'build',
      owner: 'Builder',
      goal: 'build',
      dependencies: [],
      status: 'running' as const,
      attempts: 1,
      artifacts: [],
      approved: true,
      messageId: 'request-1',
    }],
  };
  const events = [
    { sequence: 1, eventType: 'workflow.running', entityType: 'workflow', entityId: 'wf', payload: {}, createdAt: 1 },
    { sequence: 2, eventType: 'message.acknowledged', entityType: 'message', entityId: 'request-1', payload: {}, createdAt: 2 },
    { sequence: 3, eventType: 'agent.ready', entityType: 'agent', entityId: 'Other', payload: {}, createdAt: 3 },
  ];
  assert.deepEqual(getWorkflowTimeline(workflow, events).map((event) => event.sequence), [1, 2]);
});

test('health checks inspect Git, CLI, and prompt configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'starlight-health-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root });
    const prompt = join(root, 'prompt.md');
    writeFileSync(prompt, '# prompt\n');
    const checks = runWorkspaceHealthChecks({
      workspaceRoot: root,
      agentConfigs: {
        Hub: { paneId: 'Hub', cliCommand: process.execPath, promptPath: prompt },
        Broken: { paneId: 'Broken', cliCommand: 'definitely-missing-starlight-cli', promptPath: join(root, 'missing.md') },
      },
    });
    assert.equal(checks.find((check) => check.id === 'git')?.status, 'pass');
    assert.equal(checks.find((check) => check.id === 'cli:Hub')?.status, 'pass');
    assert.equal(checks.find((check) => check.id === 'cli:Broken')?.status, 'fail');
    assert.equal(checks.find((check) => check.id === 'prompt:Broken')?.status, 'fail');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('diagnostic exports recursively redact secrets', () => {
  const redacted = redactDiagnostics({
    apiKey: 'plain-secret',
    nested: { authorization: 'Bearer abc123', safe: 'visible', tokenText: 'secret' },
    output: 'use sk-example-secret',
    command: 'run --password=hunter2',
  }) as any;
  assert.equal(redacted.apiKey, '[REDACTED]');
  assert.equal(redacted.nested.authorization, '[REDACTED]');
  assert.equal(redacted.nested.tokenText, '[REDACTED]');
  assert.equal(redacted.output, '[REDACTED]');
  assert.equal(redacted.command, '[REDACTED]');
  assert.equal(redacted.nested.safe, 'visible');
  assert.equal((createDiagnosticBundle({ generatedAt: 'now', snapshot: { password: 'hidden' }, health: [] }) as any).snapshot.password, '[REDACTED]');
});
