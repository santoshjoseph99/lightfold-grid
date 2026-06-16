import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { WorktreeManager } from '../electron/worktreeManager.ts';
import { WorkflowEngine } from '../src/services/workflowCore.ts';
import { HeadlessBroker } from './support/headlessBroker.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fakeAgent = join(here, 'fixtures', 'fake-agent.mjs');
const codingFixture = join(here, 'fixtures', 'coding-project');
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
const wheel = {
  Hub: ['Spoke-A', 'Spoke-B', 'Spoke-C', 'Builder'],
  'Spoke-A': ['Hub'],
  'Spoke-B': ['Hub'],
  'Spoke-C': ['Hub'],
  Builder: ['Hub'],
};

const waitFor = async (condition: () => boolean, message: string, timeout = 5_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
};

const spawn = (broker: HeadlessBroker, root: string, id: string, options: string[] = []) =>
  broker.spawnAgent({
    id,
    executable: process.execPath,
    args: [fakeAgent, `--id=${id}`, ...options],
    cwd: root,
    env,
  });

test('real PTY wheel survives delayed readiness, malformed output, and a retried acknowledgement', { timeout: 10_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'lightfold-grid-pty-wheel-'));
  const broker = new HeadlessBroker({
    databasePath: join(root, 'broker.sqlite'),
    connections: wheel,
    acknowledgementTimeoutMs: 100,
    retryBaseDelayMs: 20,
    completionTimeoutMs: 2_000,
    maxAttempts: 3,
  });
  try {
    spawn(broker, root, 'Hub');
    spawn(broker, root, 'Spoke-A', ['--ready-delay=180', '--malformed=true']);
    spawn(broker, root, 'Spoke-B', [`--drop-ack=true`, `--marker=${join(root, 'spoke-b')}`]);
    spawn(broker, root, 'Spoke-C');

    const messages = [
      broker.submit('Hub', 'Spoke-A', 'delayed agent task'),
      broker.submit('Hub', 'Spoke-B', 'retry task'),
      broker.submit('Hub', 'Spoke-C', 'normal task'),
    ];
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (broker.lifecycle.get('Spoke-A')?.state !== 'ready') {
      assert.equal(broker.requests.get(messages[0].messageId)?.status, 'queued');
    }
    await waitFor(
      () => messages.every((message) => broker.requests.get(message.messageId)?.status === 'completed'),
      'wheel requests did not complete'
    );

    assert.equal(broker.requests.get(messages[1].messageId)?.attempt, 2);
    assert.ok(broker.parseErrors.length >= 1);
    assert.deepEqual(
      ['Hub', 'Spoke-A', 'Spoke-B', 'Spoke-C'].map((id) => broker.lifecycle.get(id)?.state),
      ['ready', 'ready', 'ready', 'ready']
    );
    const snapshot = broker.store.snapshot();
    assert.equal(snapshot.messages.filter((message) => message.status === 'completed').length, 3);
    assert.ok(snapshot.events.length > 3);
  } finally {
    broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('real PTY request recovers after an agent crash and restart', { timeout: 10_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'lightfold-grid-pty-crash-'));
  const marker = join(root, 'crashing-agent');
  const broker = new HeadlessBroker({
    databasePath: join(root, 'broker.sqlite'),
    connections: wheel,
    acknowledgementTimeoutMs: 200,
    retryBaseDelayMs: 20,
    completionTimeoutMs: 2_000,
  });
  try {
    spawn(broker, root, 'Hub');
    spawn(broker, root, 'Spoke-A', [`--crash=true`, `--marker=${marker}`]);
    await waitFor(() => broker.lifecycle.get('Spoke-A')?.state === 'ready', 'crashing agent never became ready');
    const message = broker.submit('Hub', 'Spoke-A', 'survive a crash');
    await waitFor(() => broker.requests.get(message.messageId)?.status === 'failed', 'crash did not fail request');
    assert.equal(broker.lifecycle.get('Spoke-A')?.state, 'failed');

    spawn(broker, root, 'Spoke-A', [`--crash=true`, `--marker=${marker}`]);
    await waitFor(() => broker.lifecycle.get('Spoke-A')?.state === 'ready', 'restarted agent never became ready');
    assert.equal(broker.requests.retry(message.messageId), true);
    await waitFor(() => broker.requests.get(message.messageId)?.status === 'completed', 'retried crash request did not complete');
  } finally {
    broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('coding workflow completes isolated PTY edit, tests, review, and merge', { timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'lightfold-grid-coding-e2e-'));
  const repository = join(root, 'repository');
  cpSync(codingFixture, repository, { recursive: true });
  const git = (args: string[], cwd = repository) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'lightfold-grid@example.test']);
  git(['config', 'user.name', 'Lightfold Grid Test']);
  git(['config', 'core.autocrlf', 'false']);
  git(['add', '.']);
  git(['commit', '-m', 'initial']);

  const broker = new HeadlessBroker({ databasePath: join(root, 'broker.sqlite'), connections: wheel });
  const worktrees = new WorktreeManager({ onUpdate: (record) => broker.store.upsertWorktree(record) });
  const workflows = new WorkflowEngine({ onWorkflowUpdate: (workflow) => broker.store.upsertWorkflow(workflow) });
  try {
    spawn(broker, root, 'Hub');
    spawn(broker, root, 'Builder');
    await waitFor(() => broker.lifecycle.get('Builder')?.state === 'ready', 'builder never became ready');
    workflows.create({
      id: 'coding-e2e',
      name: 'Fix addition',
      goal: 'Fix and verify addition',
      createdBy: 'Hub',
      tasks: [{
        id: 'fix',
        owner: 'Builder',
        goal: 'Fix math implementation',
        coding: { files: ['math.js'], testCommand: 'npm test' },
      }],
    });
    workflows.approveTask('coding-e2e', 'fix');
    const worktree = worktrees.prepare(repository, 'coding-e2e', 'fix', 'Builder', {
      files: ['math.js'],
      testCommand: 'npm test',
    });
    const instruction = `STARLIGHT_CODE ${JSON.stringify({
      cwd: worktree.worktreePath,
      file: 'math.js',
      content: 'export const add = (left, right) => left + right;\n',
      commit: 'fix addition',
    })}`;
    const message = broker.submit('Hub', 'Builder', instruction);
    workflows.assignTask('coding-e2e', 'fix', message.messageId);
    workflows.taskRunning('coding-e2e', 'fix');
    await waitFor(() => broker.requests.get(message.messageId)?.status === 'completed', 'coding agent did not complete');
    workflows.submitForReview('coding-e2e', 'fix', { summary: 'implementation complete' });
    const reviewed = worktrees.runTests('coding-e2e', 'fix');
    assert.equal(reviewed.status, 'review');
    worktrees.approveReview('coding-e2e', 'fix');
    const merged = worktrees.merge('coding-e2e', 'fix');
    workflows.updateWorktree('coding-e2e', 'fix', merged);
    workflows.completeReview('coding-e2e', 'fix');

    assert.equal(workflows.get('coding-e2e')?.status, 'completed');
    assert.equal(readFileSync(join(repository, 'math.js'), 'utf8'), 'export const add = (left, right) => left + right;\n');
    assert.equal(broker.store.snapshot().worktrees[0].status, 'merged');
  } finally {
    broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});
