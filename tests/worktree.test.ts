import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WorktreeError, WorktreeManager } from '../electron/worktreeManager.ts';

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const repository = () => {
  const root = mkdtempSync(join(tmpdir(), 'lightfold-grid-worktree-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'lightfold-grid@example.test']);
  git(root, ['config', 'user.name', 'Lightfold Grid Test']);
  git(root, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(root, 'shared.txt'), 'base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);
  return root;
};

const commitFile = (worktree: string, filename: string, content: string) => {
  writeFileSync(join(worktree, filename), content);
  git(worktree, ['add', filename]);
  git(worktree, ['commit', '-m', `update ${filename}`]);
};

const pass = 'node -e ""';
const fail = 'node -e "process.exit(7)"';
const featureExists = 'node -e "require(\'fs\').accessSync(\'feature.txt\')"';

test('creates isolated branches and cleans merged worktrees explicitly', () => {
  const root = repository();
  try {
    const manager = new WorktreeManager();
    const record = manager.prepare(root, 'workflow', 'task', 'Builder', {
      files: ['feature.txt'],
      testCommand: featureExists,
    });
    assert.equal(git(record.worktreePath, ['branch', '--show-current']), 'lightfold-grid/workflow/task');
    commitFile(record.worktreePath, 'feature.txt', 'done\n');
    assert.deepEqual(manager.inspect('workflow', 'task').changedFiles, ['feature.txt']);
    manager.runTests('workflow', 'task');
    manager.approveReview('workflow', 'task');
    commitFile(record.worktreePath, 'feature.txt', 'done and reviewed\n');
    assert.throws(() => manager.merge('workflow', 'task'), /changed after its passing test run/);
    manager.runTests('workflow', 'task');
    manager.approveReview('workflow', 'task');
    assert.equal(manager.merge('workflow', 'task').status, 'merged');
    assert.equal(readFileSync(join(root, 'feature.txt'), 'utf8'), 'done and reviewed\n');
    assert.equal(manager.cleanup('workflow', 'task').status, 'cleaned');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('allows parallel non-conflicting ownership and rejects overlapping files', () => {
  const root = repository();
  try {
    const manager = new WorktreeManager();
    manager.prepare(root, 'workflow', 'a', 'A', { files: ['a.txt'], testCommand: pass });
    manager.prepare(root, 'workflow', 'b', 'B', { files: ['b.txt'], testCommand: pass });
    assert.throws(
      () => manager.prepare(root, 'workflow', 'c', 'C', { files: ['a.txt'], testCommand: pass }),
      (error: unknown) => error instanceof WorktreeError && error.message.includes('File ownership conflict')
    );
    const approved = manager.prepare(root, 'workflow', 'c', 'C', {
      files: ['a.txt'],
      testCommand: pass,
      allowSharedFiles: true,
    });
    assert.equal(approved.sharedFilesApproved, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('surfaces actual changed-file and merge conflicts without damaging integration workspace', () => {
  const root = repository();
  try {
    const manager = new WorktreeManager();
    const first = manager.prepare(root, 'workflow', 'first', 'A', { files: ['first.txt'], testCommand: pass });
    const second = manager.prepare(root, 'workflow', 'second', 'B', { files: ['second.txt'], testCommand: pass });
    commitFile(first.worktreePath, 'shared.txt', 'first\n');
    commitFile(second.worktreePath, 'shared.txt', 'second\n');
    assert.equal(manager.inspect('workflow', 'first').status, 'review');
    assert.equal(manager.inspect('workflow', 'second').status, 'conflicted');
    manager.approveSharedFiles('workflow', 'first');
    manager.runTests('workflow', 'first');
    manager.approveReview('workflow', 'first');
    assert.equal(manager.merge('workflow', 'first').status, 'merged');
    manager.approveSharedFiles('workflow', 'second');
    manager.runTests('workflow', 'second');
    manager.approveReview('workflow', 'second');
    assert.equal(manager.merge('workflow', 'second').status, 'conflicted');
    assert.equal(git(root, ['status', '--porcelain']), '');
    assert.equal(readFileSync(join(root, 'shared.txt'), 'utf8'), 'first\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects failed test branches and preserves them until forced cleanup', () => {
  const root = repository();
  try {
    const manager = new WorktreeManager();
    const record = manager.prepare(root, 'workflow', 'failing', 'Builder', {
      files: ['feature.txt'],
      testCommand: fail,
    });
    commitFile(record.worktreePath, 'feature.txt', 'broken\n');
    assert.equal(manager.runTests('workflow', 'failing').status, 'tests-failed');
    assert.equal(manager.cleanup('workflow', 'failing').status, 'preserved');
    assert.equal(manager.cleanup('workflow', 'failing', true).status, 'cleaned');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
