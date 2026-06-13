import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';

export type CodingWorktreeStatus =
  | 'active'
  | 'review'
  | 'conflicted'
  | 'tests-failed'
  | 'merged'
  | 'preserved'
  | 'cleaned';

export interface CodingTaskConfig {
  files?: string[];
  testCommand?: string;
  allowSharedFiles?: boolean;
}

export interface CodingWorktreeRecord {
  workflowId: string;
  taskId: string;
  owner: string;
  workspaceRoot: string;
  worktreePath: string;
  branch: string;
  baseCommit: string;
  declaredFiles: string[];
  changedFiles: string[];
  status: CodingWorktreeStatus;
  testCommand?: string;
  testOutput?: string;
  testedCommit?: string;
  error?: string;
  reviewApproved: boolean;
  sharedFilesApproved: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorktreeManagerOptions {
  now?: () => number;
  onUpdate?: (record: CodingWorktreeRecord) => void;
}

const keyFor = (workflowId: string, taskId: string) => `${workflowId}:${taskId}`;
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'task';
const normalizeFile = (value: string) => value.replace(/\\/g, '/').replace(/^\.\/+/, '');
const copyRecord = (record: CodingWorktreeRecord): CodingWorktreeRecord => ({
  ...record,
  declaredFiles: [...record.declaredFiles],
  changedFiles: [...record.changedFiles],
});

export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorktreeError';
  }
}

export class WorktreeManager {
  private readonly records = new Map<string, CodingWorktreeRecord>();
  private readonly now: () => number;
  private readonly onUpdate?: (record: CodingWorktreeRecord) => void;

  constructor(options: WorktreeManagerOptions = {}) {
    this.now = options.now || Date.now;
    this.onUpdate = options.onUpdate;
  }

  restore(records: CodingWorktreeRecord[]) {
    records.forEach((record) => this.records.set(keyFor(record.workflowId, record.taskId), copyRecord(record)));
  }

  isGitRepository(workspaceRoot: string): boolean {
    try {
      return this.git(workspaceRoot, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
    } catch {
      return false;
    }
  }

  prepare(
    workspaceRoot: string,
    workflowId: string,
    taskId: string,
    owner: string,
    config: CodingTaskConfig = {}
  ): CodingWorktreeRecord {
    if (!this.isGitRepository(workspaceRoot)) {
      throw new WorktreeError('Coding workflows require a Git repository workspace.');
    }
    const recordKey = keyFor(workflowId, taskId);
    const existing = this.records.get(recordKey);
    if (existing && existing.status !== 'cleaned') return copyRecord(existing);

    const declaredFiles = [...new Set((config.files || []).map(normalizeFile).filter(Boolean))].sort();
    if (declaredFiles.some((file) => path.isAbsolute(file) || file.split('/').includes('..'))) {
      throw new WorktreeError('Declared coding files must be project-relative paths.');
    }
    if (!config.testCommand?.trim()) {
      throw new WorktreeError('Coding tasks require a non-empty test command.');
    }
    const conflicts = this.findOwnershipConflicts(recordKey, declaredFiles, workspaceRoot);
    if (conflicts.length > 0 && !config.allowSharedFiles) {
      throw new WorktreeError(`File ownership conflict: ${conflicts.join(', ')}.`);
    }

    const baseCommit = this.git(workspaceRoot, ['rev-parse', 'HEAD']).trim();
    const gitCommonDir = this.git(workspaceRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
    const worktreeRoot = path.join(gitCommonDir, 'starlight-worktrees');
    mkdirSync(worktreeRoot, { recursive: true });
    const suffix = `${safeName(workflowId)}-${safeName(taskId)}`;
    const worktreePath = path.join(worktreeRoot, suffix);
    const branch = `starlight/${safeName(workflowId)}/${safeName(taskId)}`;
    if (existsSync(worktreePath)) {
      throw new WorktreeError(`Worktree path already exists: ${worktreePath}`);
    }
    this.git(workspaceRoot, ['worktree', 'add', '-b', branch, worktreePath, baseCommit]);
    const timestamp = this.now();
    const record: CodingWorktreeRecord = {
      workflowId,
      taskId,
      owner,
      workspaceRoot,
      worktreePath,
      branch,
      baseCommit,
      declaredFiles,
      changedFiles: [],
      status: 'active',
      testCommand: config.testCommand,
      reviewApproved: false,
      sharedFilesApproved: Boolean(config.allowSharedFiles),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.records.set(recordKey, record);
    return this.update(record);
  }

  inspect(workflowId: string, taskId: string): CodingWorktreeRecord {
    const record = this.require(workflowId, taskId);
    const output = this.git(record.worktreePath, ['status', '--porcelain']);
    const committed = this.git(record.worktreePath, ['diff', '--name-only', `${record.baseCommit}...HEAD`]);
    record.changedFiles = [...new Set([
      ...committed.split('\n').filter(Boolean).map(normalizeFile),
      ...output.split('\n').filter(Boolean).map((line) => {
        const statusPath = line.slice(3).trim();
        return normalizeFile(statusPath.includes(' -> ') ? statusPath.split(' -> ').pop()! : statusPath);
      }),
    ])].sort();
    const conflicts = this.findOwnershipConflicts(keyFor(workflowId, taskId), record.changedFiles, record.workspaceRoot);
    if (conflicts.length > 0 && !record.sharedFilesApproved) {
      record.status = 'conflicted';
      record.error = `Changed files conflict with another active task: ${conflicts.join(', ')}.`;
    } else if (!['merged', 'cleaned', 'tests-failed'].includes(record.status)) {
      record.status = 'review';
      record.error = undefined;
    }
    return this.update(record);
  }

  approveSharedFiles(workflowId: string, taskId: string): CodingWorktreeRecord {
    const record = this.require(workflowId, taskId);
    record.sharedFilesApproved = true;
    record.status = 'review';
    record.error = undefined;
    return this.update(record);
  }

  runTests(workflowId: string, taskId: string): CodingWorktreeRecord {
    const record = this.inspect(workflowId, taskId);
    if (record.status === 'conflicted') return record;
    if (this.git(record.worktreePath, ['status', '--porcelain']).trim()) {
      record.status = 'tests-failed';
      record.error = 'Coding task has uncommitted changes; commit them before review.';
      record.testedCommit = undefined;
      return this.update(record);
    }
    try {
      record.testOutput = execFileSync('/bin/sh', ['-lc', record.testCommand!], {
        cwd: record.worktreePath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      record.status = 'review';
      record.error = undefined;
      record.testedCommit = this.git(record.worktreePath, ['rev-parse', 'HEAD']).trim();
    } catch (error: any) {
      record.testOutput = `${error.stdout || ''}${error.stderr || ''}`.trim();
      record.status = 'tests-failed';
      record.error = `Test command failed: ${record.testCommand}`;
      record.testedCommit = undefined;
    }
    return this.update(record);
  }

  approveReview(workflowId: string, taskId: string): CodingWorktreeRecord {
    const record = this.require(workflowId, taskId);
    if (record.status !== 'review') throw new WorktreeError(`Worktree is not ready for review: ${record.status}.`);
    record.reviewApproved = true;
    return this.update(record);
  }

  merge(workflowId: string, taskId: string): CodingWorktreeRecord {
    const record = this.require(workflowId, taskId);
    if (!record.reviewApproved || record.status !== 'review') {
      throw new WorktreeError('A passing test run and explicit review approval are required before merge.');
    }
    const currentCommit = this.git(record.worktreePath, ['rev-parse', 'HEAD']).trim();
    if (!record.testedCommit || currentCommit !== record.testedCommit) {
      throw new WorktreeError('Task branch changed after its passing test run; run tests and review it again.');
    }
    if (this.git(record.worktreePath, ['status', '--porcelain']).trim()) {
      throw new WorktreeError('Task worktree must be clean before merge.');
    }
    const rootStatus = this.git(record.workspaceRoot, ['status', '--porcelain']).trim();
    if (rootStatus) throw new WorktreeError('Integration workspace must be clean before merging a coding task.');
    try {
      this.git(record.workspaceRoot, ['merge', '--no-ff', '--no-edit', record.branch]);
      record.status = 'merged';
      record.error = undefined;
    } catch (error: any) {
      try {
        this.git(record.workspaceRoot, ['merge', '--abort']);
      } catch {
        // Git may reject abort when it detected the conflict before starting a merge.
      }
      record.status = 'conflicted';
      record.error = `Merge conflict for branch ${record.branch}: ${error.message}`;
    }
    return this.update(record);
  }

  cleanup(workflowId: string, taskId: string, force = false): CodingWorktreeRecord {
    const record = this.require(workflowId, taskId);
    if (!force && !['merged', 'review'].includes(record.status)) {
      record.status = 'preserved';
      record.error = 'Failed or conflicted worktrees require explicit forced cleanup.';
      return this.update(record);
    }
    this.git(record.workspaceRoot, ['worktree', 'remove', '--force', record.worktreePath]);
    try {
      this.git(record.workspaceRoot, ['branch', '-D', record.branch]);
    } catch {
      // A merged branch may already have been removed outside Starlight.
    }
    record.status = 'cleaned';
    record.error = undefined;
    return this.update(record);
  }

  get(workflowId: string, taskId: string): CodingWorktreeRecord | undefined {
    const record = this.records.get(keyFor(workflowId, taskId));
    return record ? copyRecord(record) : undefined;
  }

  values(): CodingWorktreeRecord[] {
    return [...this.records.values()].map(copyRecord);
  }

  private findOwnershipConflicts(recordKey: string, files: string[], workspaceRoot: string): string[] {
    const desired = new Set(files);
    const conflicts = new Set<string>();
    this.records.forEach((record, key) => {
      if (
        key === recordKey ||
        record.workspaceRoot !== workspaceRoot ||
        ['merged', 'cleaned'].includes(record.status) ||
        record.sharedFilesApproved
      ) return;
      [...record.declaredFiles, ...record.changedFiles].forEach((file) => {
        if (desired.has(file)) conflicts.add(file);
      });
    });
    return [...conflicts].sort();
  }

  private require(workflowId: string, taskId: string): CodingWorktreeRecord {
    const record = this.records.get(keyFor(workflowId, taskId));
    if (!record) throw new WorktreeError(`Unknown coding worktree ${workflowId}/${taskId}.`);
    return record;
  }

  private update(record: CodingWorktreeRecord): CodingWorktreeRecord {
    record.updatedAt = this.now();
    const copy = copyRecord(record);
    this.records.set(keyFor(record.workflowId, record.taskId), copyRecord(record));
    this.onUpdate?.(copy);
    return copy;
  }

  private git(cwd: string, args: string[]): string {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error: any) {
      const detail = String(error.stderr || error.message || error).trim();
      throw new WorktreeError(detail || `Git command failed: git ${args.join(' ')}`);
    }
  }
}
