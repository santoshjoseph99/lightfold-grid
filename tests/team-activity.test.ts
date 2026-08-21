import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrokerObservabilitySnapshot } from '../src/services/observability.ts';
import { createTeamActivitySnapshot } from '../src/services/teamActivity.ts';
import type { StarlightMessage } from '../src/services/brokerProtocol.ts';
import type { RoutingDecision } from '../src/services/modelRouting.ts';
import type { WorkflowRecord, WorkflowTaskRecord, WorkflowTaskStatus } from '../src/services/workflowCore.ts';

const decision = (overrides: Partial<RoutingDecision> = {}): RoutingDecision => ({
  selectedAgentId: 'Builder',
  selectedModel: 'qwen3-coder:30b',
  selectedPrivacy: 'local',
  estimatedCostUsd: 0.01,
  strongestModelCostUsd: 0.08,
  estimatedSavingsUsd: 0.07,
  reason: 'Selected the least expensive eligible model from 2 candidates.',
  escalation: 0,
  evaluatedAt: 100,
  candidates: [],
  ...overrides,
});

const task = (overrides: Partial<WorkflowTaskRecord> = {}): WorkflowTaskRecord => ({
  workflowId: 'wf',
  id: 'build',
  owner: 'Builder',
  goal: 'Implement the feature',
  dependencies: [],
  status: 'running',
  attempts: 1,
  artifacts: [],
  approved: true,
  messageId: 'request-1',
  routingHistory: [decision()],
  routingDecision: decision(),
  assignedAt: 150,
  usage: { promptTokens: 100, completionTokens: 25, actualCostUsd: 0.002 },
  ...overrides,
});

const workflow = (tasks: WorkflowTaskRecord[]): WorkflowRecord => ({
  id: 'wf',
  name: 'Feature workflow',
  goal: 'Ship the feature',
  createdBy: 'Orchestrator',
  status: 'running',
  budget: { maxEstimatedCostUsd: 0.1, maxCloudAssignments: 1 },
  createdAt: 1,
  updatedAt: 200,
  tasks,
});

const message = (overrides: Partial<StarlightMessage> = {}): StarlightMessage => ({
  protocolVersion: 1,
  messageId: 'request-1',
  id: 'request-1',
  taskId: 'build',
  from: 'Orchestrator',
  to: 'Builder',
  kind: 'request',
  payload: { instruction: 'Implement the feature' },
  attempt: 1,
  timestamp: 120,
  command: 'Implement the feature',
  type: 'request',
  status: 'acknowledged',
  ...overrides,
});

const snapshot = (overrides: Partial<BrokerObservabilitySnapshot> = {}): BrokerObservabilitySnapshot => ({
  agents: [
    {
      agentId: 'Orchestrator',
      role: 'Orchestrator',
      state: 'ready',
      lastHeartbeatAt: 90,
    },
    {
      agentId: 'Builder',
      role: 'Builder',
      state: 'busy',
      currentTaskId: 'build',
      lastHeartbeatAt: 125,
    },
  ],
  messages: [
    message(),
    message({
      messageId: 'ack-1',
      id: 'ack-1',
      kind: 'ack',
      from: 'Builder',
      to: 'Orchestrator',
      correlationId: 'request-1',
      payload: { summary: 'accepted' },
      status: 'completed',
      timestamp: 130,
    }),
    message({
      messageId: 'adhoc',
      id: 'adhoc',
      taskId: 'not-a-workflow-task',
      from: 'Orchestrator',
      to: 'Reviewer',
      payload: { instruction: 'This direct message is intentionally hidden for now.' },
      status: 'completed',
      timestamp: 140,
    }),
  ],
  workflows: [workflow([
    task(),
    task({
      id: 'review',
      owner: 'Reviewer',
      goal: 'Review the change',
      dependencies: ['build'],
      status: 'blocked',
      attempts: 0,
      messageId: undefined,
      routingHistory: [],
      routingDecision: undefined,
      error: 'Waiting on build.',
    }),
    task({
      id: 'test',
      owner: 'Tester',
      goal: 'Run tests',
      dependencies: ['build'],
      status: 'reviewing',
      artifacts: ['test.log'],
      worktree: {
        branch: 'lightfold-grid/wf/test',
        worktreePath: '/tmp/wf-test',
        baseCommit: 'abc123',
        changedFiles: ['math.test.js'],
        status: 'tested',
      },
    }),
  ])],
  events: [
    {
      sequence: 1,
      eventType: 'workflow.running',
      entityType: 'workflow',
      entityId: 'wf',
      payload: {},
      createdAt: 100,
    },
  ],
  ...overrides,
});

test('creates a workflow-only Team Room projection with agent cards and message modes', () => {
  const team = createTeamActivitySnapshot(snapshot(), 'graph');
  assert.equal(team.controls.replacesOpsPanel, true);
  assert.equal(team.controls.workflowOnly, true);
  assert.deepEqual(team.controls.messageModes, ['stream', 'graph']);
  assert.equal(team.messageFlow.mode, 'graph');
  assert.equal(team.agents.find((agent) => agent.agentId === 'Builder')?.currentTask?.taskId, 'build');
  assert.equal(team.agents.find((agent) => agent.agentId === 'Builder')?.estimatedCostUsd, 0.01);
  assert.equal(team.agents.find((agent) => agent.agentId === 'Builder')?.promptTokens, 100);
  assert.deepEqual(team.messageFlow.stream.map((entry) => entry.messageId), ['ack-1', 'request-1']);
  assert.equal(team.messageFlow.graph.edges.length, 2);
  assert.equal(team.messageFlow.stream.some((entry) => entry.messageId === 'adhoc'), false);
});

test('groups workflow tasks into board columns with blockers and worktree evidence', () => {
  const team = createTeamActivitySnapshot(snapshot());
  const blocked = team.workflowBoard.find((column) => column.id === 'blocked')!;
  const reviewing = team.workflowBoard.find((column) => column.id === 'reviewing')!;
  assert.deepEqual(blocked.tasks.map((card) => card.taskId), ['review']);
  assert.equal(blocked.tasks[0].blockedReason, 'Waiting on build.');
  assert.deepEqual(reviewing.tasks.map((card) => card.taskId), ['test']);
  assert.deepEqual(reviewing.tasks[0].worktree?.changedFiles, ['math.test.js']);
});

test('summarizes model cost, budget impact, and escalation history', () => {
  const team = createTeamActivitySnapshot(snapshot({
    workflows: [workflow([
      task({
        routingHistory: [
          decision({ selectedAgentId: 'Local', estimatedCostUsd: 0.005, estimatedSavingsUsd: 0.075 }),
          decision({
            selectedAgentId: 'Cloud',
            selectedModel: 'cloud-strong',
            selectedPrivacy: 'cloud',
            estimatedCostUsd: 0.025,
            estimatedSavingsUsd: 0.02,
            escalation: 1,
          }),
        ],
        routingDecision: decision({
          selectedAgentId: 'Cloud',
          selectedModel: 'cloud-strong',
          selectedPrivacy: 'cloud',
          estimatedCostUsd: 0.025,
          estimatedSavingsUsd: 0.02,
          escalation: 1,
        }),
      }),
    ])],
  }));
  assert.equal(team.modelCosts[0].estimatedCostUsd, 0.03);
  assert.equal(team.modelCosts[0].estimatedSavingsUsd, 0.095);
  assert.equal(team.modelCosts[0].budgetRemainingUsd, 0.07);
  assert.equal(team.modelCosts[0].cloudAssignments, 1);
  assert.equal(team.modelCosts[0].escalations, 1);
  assert.deepEqual(team.modelCosts[0].routedTasks.map((task) => task.model), ['cloud-strong']);
});

test('marks retries, failures, and terminal summaries without treating them as proof', () => {
  const team = createTeamActivitySnapshot(snapshot({
    messages: [
      message({
        attempt: 2,
        payload: { summary: 'retrying after timeout' },
        status: 'queued',
      }),
      message({
        messageId: 'error-1',
        id: 'error-1',
        kind: 'error',
        from: 'Builder',
        to: 'Orchestrator',
        correlationId: 'request-1',
        payload: { summary: 'terminal reported failure' },
        status: 'failed',
        timestamp: 150,
      }),
    ],
  }));
  assert.equal(team.controls.allowTerminalSummaries, true);
  assert.deepEqual(team.messageFlow.stream.map((entry) => entry.severity), ['error', 'warning']);
  assert.deepEqual(team.messageFlow.stream.map((entry) => entry.summary), ['terminal reported failure', 'retrying after timeout']);
});
