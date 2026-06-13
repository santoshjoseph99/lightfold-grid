import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkflowEngine, WorkflowValidationError } from '../src/services/workflowCore.ts';
import type { WorkflowDefinition } from '../src/services/workflowCore.ts';

const definition = (overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  id: 'workflow-1',
  name: 'Feature delivery',
  goal: 'Implement and verify a feature',
  createdBy: 'Hub',
  tasks: [
    { id: 'spec', owner: 'Spec', goal: 'Write specification' },
    { id: 'implement', owner: 'Builder', goal: 'Implement feature', dependencies: ['spec'] },
    {
      id: 'test',
      owner: 'Tester',
      goal: 'Run tests',
      dependencies: ['implement'],
      completionCriteria: { requiredArtifacts: ['test.log'], summaryIncludes: ['passed'] },
    },
    { id: 'review', owner: 'Reviewer', goal: 'Review release', dependencies: ['test'], requiresApproval: true },
  ],
  ...overrides,
});

test('schedules a dependency graph in order and gates risky tasks for approval', () => {
  const dispatched: string[] = [];
  const engine = new WorkflowEngine({ onDispatch: (task) => dispatched.push(task.id) }, () => 10);
  engine.create(definition());
  assert.deepEqual(dispatched, ['spec']);
  engine.assignTask('workflow-1', 'spec', 'message-spec');
  engine.taskRunning('workflow-1', 'spec');
  engine.submitResult('workflow-1', 'spec', { summary: 'done' });
  assert.deepEqual(dispatched, ['spec', 'implement']);
  engine.assignTask('workflow-1', 'implement', 'message-implement');
  engine.submitResult('workflow-1', 'implement', { summary: 'done' });
  engine.assignTask('workflow-1', 'test', 'message-test');
  engine.submitResult('workflow-1', 'test', { summary: 'tests passed', artifacts: ['test.log'] });

  assert.equal(engine.get('workflow-1')?.tasks.find((task) => task.id === 'review')?.status, 'ready');
  assert.deepEqual(dispatched, ['spec', 'implement', 'test']);
  assert.equal(engine.approveTask('workflow-1', 'review'), true);
  assert.deepEqual(dispatched, ['spec', 'implement', 'test', 'review']);
  engine.assignTask('workflow-1', 'review', 'message-review');
  engine.submitResult('workflow-1', 'review', { summary: 'approved' });
  assert.equal(engine.get('workflow-1')?.status, 'completed');
});

test('dispatches independent tasks in parallel before their shared dependent', () => {
  const dispatched: string[] = [];
  const engine = new WorkflowEngine({ onDispatch: (task) => dispatched.push(task.id) });
  engine.create(definition({
    tasks: [
      { id: 'frontend', owner: 'A', goal: 'Build frontend' },
      { id: 'backend', owner: 'B', goal: 'Build backend' },
      { id: 'integration', owner: 'C', goal: 'Integrate', dependencies: ['frontend', 'backend'] },
    ],
  }));
  assert.deepEqual(dispatched.sort(), ['backend', 'frontend']);
  engine.assignTask('workflow-1', 'frontend', 'front-message');
  engine.submitResult('workflow-1', 'frontend', {});
  assert.equal(dispatched.includes('integration'), false);
  engine.assignTask('workflow-1', 'backend', 'back-message');
  engine.submitResult('workflow-1', 'backend', {});
  assert.equal(dispatched.includes('integration'), true);
});

test('validates completion criteria and blocks dependent tasks after failure', () => {
  const engine = new WorkflowEngine();
  engine.create(definition());
  engine.assignTask('workflow-1', 'spec', 'message-spec');
  engine.submitResult('workflow-1', 'spec', {});
  engine.assignTask('workflow-1', 'implement', 'message-implement');
  engine.submitResult('workflow-1', 'implement', {});
  engine.assignTask('workflow-1', 'test', 'message-test');
  assert.equal(engine.submitResult('workflow-1', 'test', { summary: 'failed' }), false);
  const workflow = engine.get('workflow-1')!;
  assert.equal(workflow.tasks.find((task) => task.id === 'test')?.status, 'failed');
  assert.equal(workflow.tasks.find((task) => task.id === 'review')?.status, 'blocked');
  assert.equal(workflow.status, 'failed');
});

test('supports retry, reassignment, cancellation, and cancel-workflow failure policies', () => {
  const engine = new WorkflowEngine();
  engine.create(definition({
    tasks: [
      { id: 'retry', owner: 'A', goal: 'retry me', failurePolicy: 'retry', maxAttempts: 2 },
      { id: 'cancel', owner: 'B', goal: 'cancel all', failurePolicy: 'cancel-workflow' },
    ],
  }));
  engine.assignTask('workflow-1', 'retry', 'm1');
  engine.failTask('workflow-1', 'retry', 'first failure');
  assert.equal(engine.get('workflow-1')?.tasks[0].status, 'ready');
  engine.assignTask('workflow-1', 'retry', 'm2');
  engine.failTask('workflow-1', 'retry', 'second failure');
  assert.equal(engine.reassignTask('workflow-1', 'retry', 'C'), true);
  assert.equal(engine.get('workflow-1')?.tasks[0].owner, 'C');
  engine.assignTask('workflow-1', 'cancel', 'm3');
  engine.failTask('workflow-1', 'cancel', 'fatal');
  assert.equal(engine.get('workflow-1')?.status, 'cancelled');
});

test('rejects invalid decompositions with unknown dependencies or cycles', () => {
  const engine = new WorkflowEngine();
  assert.throws(
    () => engine.create(definition({ tasks: [{ id: 'a', owner: 'A', goal: 'A', dependencies: ['missing'] }] })),
    WorkflowValidationError
  );
  assert.throws(
    () => engine.create(definition({
      tasks: [
        { id: 'a', owner: 'A', goal: 'A', dependencies: ['b'] },
        { id: 'b', owner: 'B', goal: 'B', dependencies: ['a'] },
      ],
    })),
    WorkflowValidationError
  );
});

test('automatically gates destructive and release-related tasks', () => {
  const dispatched: string[] = [];
  const engine = new WorkflowEngine({ onDispatch: (task) => dispatched.push(task.id) });
  engine.create(definition({ tasks: [{ id: 'deploy', owner: 'Release', goal: 'Deploy to production' }] }));
  const task = engine.get('workflow-1')?.tasks[0];
  assert.equal(task?.requiresApproval, true);
  assert.equal(task?.approved, false);
  assert.deepEqual(dispatched, []);
});

test('restores running tasks as ready without dispatching duplicate messages', () => {
  const dispatched: string[] = [];
  const engine = new WorkflowEngine({ onDispatch: (task) => dispatched.push(task.id) });
  const original = new WorkflowEngine();
  original.create(definition({ tasks: [{ id: 'work', owner: 'A', goal: 'work' }] }));
  original.assignTask('workflow-1', 'work', 'existing-message');
  engine.restore(original.get('workflow-1')!);
  assert.equal(engine.get('workflow-1')?.tasks[0].status, 'ready');
  assert.equal(engine.get('workflow-1')?.tasks[0].messageId, 'existing-message');
  assert.deepEqual(dispatched, []);
});

test('holds coding task results in review until integration completes', () => {
  const engine = new WorkflowEngine();
  engine.create(definition({
    tasks: [{ id: 'code', owner: 'Builder', goal: 'Implement', coding: { files: ['src/code.ts'], testCommand: 'npm test' } }],
  }));
  assert.equal(engine.get('workflow-1')?.tasks[0].requiresApproval, true);
  engine.approveTask('workflow-1', 'code');
  engine.assignTask('workflow-1', 'code', 'message-code');
  assert.equal(engine.submitForReview('workflow-1', 'code', { summary: 'implemented' }), true);
  assert.equal(engine.get('workflow-1')?.tasks[0].status, 'reviewing');
  engine.updateWorktree('workflow-1', 'code', {
    worktreePath: '/tmp/worktree',
    branch: 'starlight/workflow-1/code',
    baseCommit: 'abc',
    changedFiles: ['src/code.ts'],
    status: 'review',
  });
  assert.equal(engine.completeReview('workflow-1', 'code'), true);
  assert.equal(engine.get('workflow-1')?.status, 'completed');
});
