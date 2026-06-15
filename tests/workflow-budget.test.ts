import assert from 'node:assert/strict';
import test from 'node:test';
import { routeTaskToModel, type AgentModelProfile, type RoutingDecision } from '../src/services/modelRouting.ts';
import { applyWorkflowBudget, calculateWorkflowBudgetUsage } from '../src/services/workflowBudget.ts';
import type { WorkflowRecord, WorkflowTaskRecord } from '../src/services/workflowCore.ts';

const profile = (agentId: string, privacy: AgentModelProfile['privacy'], cost: number): AgentModelProfile => ({
  agentId,
  model: agentId,
  privacy,
  capabilityTier: privacy === 'cloud' ? 5 : 2,
  inputCostPerMillionTokens: cost,
  outputCostPerMillionTokens: cost,
  capabilities: [],
  tools: [],
});

const decision = (agentId: string, privacy: AgentModelProfile['privacy'], cost: number): RoutingDecision => ({
  selectedAgentId: agentId,
  selectedModel: agentId,
  selectedPrivacy: privacy,
  estimatedCostUsd: cost,
  strongestModelCostUsd: cost,
  estimatedSavingsUsd: 0,
  reason: 'test',
  escalation: 0,
  evaluatedAt: 1,
  candidates: [],
});

const task = (routingHistory: RoutingDecision[], actualCostUsd?: number): WorkflowTaskRecord => ({
  workflowId: 'budgeted',
  id: `task-${routingHistory.length}-${actualCostUsd || 0}`,
  owner: 'local',
  goal: 'work',
  dependencies: [],
  status: 'completed',
  attempts: 1,
  artifacts: [],
  approved: true,
  routingHistory,
  usage: actualCostUsd === undefined ? undefined : { actualCostUsd },
});

const workflow = (tasks: WorkflowTaskRecord[]): WorkflowRecord => ({
  id: 'budgeted',
  name: 'Budgeted',
  goal: 'Stay in budget',
  createdBy: 'test',
  status: 'running',
  budget: { maxEstimatedCostUsd: 0.5, maxCloudEstimatedCostUsd: 0.25, maxCloudAssignments: 1 },
  createdAt: 1,
  updatedAt: 2,
  tasks,
});

test('calculates durable estimated, cloud, assignment, and actual workflow usage', () => {
  assert.deepEqual(calculateWorkflowBudgetUsage(workflow([
    task([decision('local', 'local', 0)]),
    task([decision('cloud', 'cloud', 0.2)], 0.18),
  ])), {
    estimatedCostUsd: 0.2,
    cloudEstimatedCostUsd: 0.2,
    cloudAssignments: 1,
    actualCostUsd: 0.18,
  });
});

test('remaining workflow budget constrains cost and disables exhausted cloud routing', () => {
  const constrained = applyWorkflowBudget(
    workflow([task([decision('cloud', 'cloud', 0.2)])]),
    { maxEstimatedCostUsd: 1, maxCloudEstimatedCostUsd: 1 },
  );
  assert.equal(constrained.maxEstimatedCostUsd, 0.3);
  assert.equal(constrained.maxCloudEstimatedCostUsd, 0.05);
  assert.equal(constrained.localOnly, true);
});

test('routing rejects candidates that exceed remaining total or cloud budget', () => {
  const profiles = [profile('local', 'local', 0), profile('cloud', 'cloud', 100)];
  const constraints = applyWorkflowBudget(
    workflow([task([decision('cloud', 'cloud', 0.2)])]),
    { estimatedInputTokens: 1_000, candidateOwners: ['cloud'] },
    profiles,
  );
  assert.throws(() => routeTaskToModel({ profiles, constraints }), /cloud use is forbidden/);
});

test('a reserved assignment immediately reduces the next task budget', () => {
  const first = decision('cloud', 'cloud', 0.3);
  const current = workflow([task([first])]);
  const next = applyWorkflowBudget(current, {});
  assert.equal(next.maxEstimatedCostUsd, 0.2);
  assert.equal(next.maxCloudEstimatedCostUsd, 0);
  assert.equal(next.localOnly, true);
});

test('durable reservations remain consumed when routing-cycle history resets', () => {
  const reservation = decision('cloud', 'cloud', 0.2);
  const current = {
    ...workflow([task([])]),
    budgetReservations: [{ taskId: 'retried', decision: reservation }],
  };
  assert.equal(calculateWorkflowBudgetUsage(current).cloudAssignments, 1);
  assert.equal(applyWorkflowBudget(current, {}).localOnly, true);
});
