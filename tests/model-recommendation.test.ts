import assert from 'node:assert/strict';
import test from 'node:test';
import { recommendModelForTask, getTaskRecommendationKey } from '../src/services/modelRecommendation.ts';
import type { AgentModelProfile, RoutingDecision } from '../src/services/modelRouting.ts';
import type { WorkflowRecord, WorkflowTaskRecord } from '../src/services/workflowCore.ts';

const profile = (agentId: string, model: string, privacy: AgentModelProfile['privacy'] = 'local'): AgentModelProfile => ({
  agentId,
  model,
  privacy,
  capabilityTier: privacy === 'local' ? 2 : 5,
  contextWindow: 32_000,
  toolSupport: true,
  inputCostPerMillionTokens: privacy === 'local' ? 0 : 4,
  outputCostPerMillionTokens: privacy === 'local' ? 0 : 12,
  capabilities: ['coding'],
  tools: ['git'],
});

const decision = (agentId: string, model: string, estimatedCostUsd: number): RoutingDecision => ({
  selectedAgentId: agentId,
  selectedModel: model,
  estimatedCostUsd,
  strongestModelCostUsd: estimatedCostUsd,
  estimatedSavingsUsd: 0,
  reason: 'historical',
  escalation: 0,
  evaluatedAt: 1,
  candidates: [],
});

const task = (overrides: Partial<WorkflowTaskRecord> = {}): WorkflowTaskRecord => ({
  workflowId: 'history',
  id: 'code',
  owner: 'local',
  goal: 'Implement feature',
  dependencies: [],
  status: 'completed',
  attempts: 1,
  artifacts: [],
  approved: true,
  requiredCapabilities: ['coding'],
  requiredTools: ['git'],
  routing: { estimatedInputTokens: 1_000 },
  routingHistory: [],
  ...overrides,
});

const workflow = (tasks: WorkflowTaskRecord[]): WorkflowRecord => ({
  id: 'history',
  name: 'History',
  goal: 'Record outcomes',
  createdBy: 'test',
  status: 'completed',
  createdAt: 1,
  updatedAt: 2,
  tasks,
});

test('matches task families independent of requirement order', () => {
  assert.equal(
    getTaskRecommendationKey(task({ requiredCapabilities: ['testing', 'coding'], requiredTools: ['npm', 'git'] })),
    getTaskRecommendationKey(task({ requiredCapabilities: ['coding', 'testing'], requiredTools: ['git', 'npm'] })),
  );
});

test('recommends the lowest-cost eligible model with successful matching history', () => {
  const recommendation = recommendModelForTask({
    profiles: [profile('local', 'small'), profile('cloud', 'strong', 'cloud')],
    workflows: [workflow([
      task({ id: 'local-1', routingDecision: decision('local', 'small', 0), usage: { actualCostUsd: 0 }, assignedAt: 10, completedAt: 30 }),
      task({ id: 'local-2', routingDecision: decision('local', 'small', 0), usage: { actualCostUsd: 0 }, assignedAt: 40, completedAt: 80 }),
      task({ id: 'cloud-1', owner: 'cloud', routingDecision: decision('cloud', 'strong', 0.25), usage: { actualCostUsd: 0.2 } }),
    ])],
    task: task({ workflowId: 'new', id: 'new', status: 'ready' }),
  });
  assert.equal(recommendation?.agentId, 'local');
  assert.equal(recommendation?.successfulTasks, 2);
  assert.equal(recommendation?.confidence, 'medium');
  assert.equal(recommendation?.averageDurationMs, 30);
  assert.equal(recommendation?.alternatives[0].agentId, 'cloud');
});

test('excludes ineligible, changed-model, failed, and non-matching outcomes', () => {
  const recommendation = recommendModelForTask({
    profiles: [profile('local', 'new-small'), profile('cloud', 'strong', 'cloud')],
    workflows: [workflow([
      task({ id: 'old-model', routingDecision: decision('local', 'old-small', 0) }),
      task({ id: 'failed', status: 'failed', routingDecision: decision('cloud', 'strong', 0.1) }),
      task({ id: 'different', requiredTools: ['npm'], routingDecision: decision('cloud', 'strong', 0.1) }),
      task({ id: 'cloud-success', routingDecision: decision('cloud', 'strong', 0.1) }),
    ])],
    task: task({ workflowId: 'new', id: 'new', status: 'ready', routing: { localOnly: true } }),
  });
  assert.equal(recommendation, undefined);
});

test('can exclude the current task from its own recommendation evidence', () => {
  const current = task({ routingDecision: decision('local', 'small', 0) });
  assert.equal(recommendModelForTask({
    profiles: [profile('local', 'small')],
    workflows: [workflow([current])],
    task: current,
    exclude: { workflowId: 'history', taskId: 'code' },
  }), undefined);
});
