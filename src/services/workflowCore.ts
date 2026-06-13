export type WorkflowStatus = 'planned' | 'running' | 'completed' | 'failed' | 'cancelled';

export type WorkflowTaskStatus =
  | 'planned'
  | 'blocked'
  | 'ready'
  | 'assigned'
  | 'running'
  | 'reviewing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WorkflowFailurePolicy = 'block' | 'retry' | 'cancel-workflow';

export interface CompletionCriteria {
  requiredArtifacts?: string[];
  summaryIncludes?: string[];
}

export interface CodingTaskConfig {
  files?: string[];
  testCommand?: string;
  allowSharedFiles?: boolean;
}

export interface CodingWorktreeSummary {
  worktreePath: string;
  branch: string;
  baseCommit: string;
  changedFiles: string[];
  status: string;
  testOutput?: string;
  error?: string;
}

export interface WorkflowTaskDefinition {
  id: string;
  owner: string;
  goal: string;
  dependencies?: string[];
  completionCriteria?: CompletionCriteria;
  failurePolicy?: WorkflowFailurePolicy;
  maxAttempts?: number;
  requiresApproval?: boolean;
  coding?: CodingTaskConfig;
  requiredCapabilities?: string[];
  requiredTools?: string[];
  promptVersion?: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  goal: string;
  createdBy: string;
  tasks: WorkflowTaskDefinition[];
}

export interface WorkflowTaskRecord extends WorkflowTaskDefinition {
  workflowId: string;
  dependencies: string[];
  status: WorkflowTaskStatus;
  attempts: number;
  artifacts: string[];
  approved: boolean;
  messageId?: string;
  summary?: string;
  error?: string;
  worktree?: CodingWorktreeSummary;
}

export interface WorkflowRecord extends Omit<WorkflowDefinition, 'tasks'> {
  status: WorkflowStatus;
  tasks: WorkflowTaskRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowTaskResult {
  summary?: string;
  artifacts?: string[];
}

export interface WorkflowEngineCallbacks {
  onWorkflowUpdate?: (workflow: WorkflowRecord) => void;
  onTaskUpdate?: (task: WorkflowTaskRecord) => void;
  onDispatch?: (task: WorkflowTaskRecord) => void;
}

const terminalTaskStates = new Set<WorkflowTaskStatus>(['completed', 'failed', 'cancelled']);
const approvalRiskPattern = /\b(release|publish|deploy|production|delet\w*|destr\w*|drop|migrat\w*)\b/i;

const copyTask = (task: WorkflowTaskRecord): WorkflowTaskRecord => ({
  ...task,
  dependencies: [...task.dependencies],
  completionCriteria: task.completionCriteria
    ? {
        requiredArtifacts: [...(task.completionCriteria.requiredArtifacts || [])],
        summaryIncludes: [...(task.completionCriteria.summaryIncludes || [])],
      }
    : undefined,
  artifacts: [...task.artifacts],
  coding: task.coding ? { ...task.coding, files: [...(task.coding.files || [])] } : undefined,
  requiredCapabilities: [...(task.requiredCapabilities || [])],
  requiredTools: [...(task.requiredTools || [])],
  worktree: task.worktree ? { ...task.worktree, changedFiles: [...task.worktree.changedFiles] } : undefined,
});

const copyWorkflow = (workflow: WorkflowRecord): WorkflowRecord => ({
  ...workflow,
  tasks: workflow.tasks.map(copyTask),
});

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

export class WorkflowEngine {
  private readonly workflows = new Map<string, WorkflowRecord>();
  private readonly callbacks: WorkflowEngineCallbacks;
  private readonly now: () => number;

  constructor(callbacks: WorkflowEngineCallbacks = {}, now: () => number = Date.now) {
    this.callbacks = callbacks;
    this.now = now;
  }

  create(definition: WorkflowDefinition): WorkflowRecord {
    this.validate(definition);
    if (this.workflows.has(definition.id)) {
      throw new WorkflowValidationError(`Workflow ${definition.id} already exists.`);
    }
    const timestamp = this.now();
    const workflow: WorkflowRecord = {
      id: definition.id,
      name: definition.name,
      goal: definition.goal,
      createdBy: definition.createdBy,
      status: 'planned',
      createdAt: timestamp,
      updatedAt: timestamp,
      tasks: definition.tasks.map((task) => ({
        ...task,
        workflowId: definition.id,
        dependencies: [...(task.dependencies || [])],
        status: 'planned',
        attempts: 0,
        artifacts: [],
        requiresApproval: task.requiresApproval || Boolean(task.coding) || approvalRiskPattern.test(task.goal),
        approved: !(task.requiresApproval || task.coding || approvalRiskPattern.test(task.goal)),
        failurePolicy: task.failurePolicy || 'block',
        maxAttempts: task.maxAttempts || 1,
      })),
    };
    this.workflows.set(workflow.id, workflow);
    this.schedule(workflow);
    return copyWorkflow(workflow);
  }

  restore(workflow: WorkflowRecord): WorkflowRecord {
    this.validate(workflow);
    const restored = copyWorkflow(workflow);
    restored.tasks = restored.tasks.map((task) => {
      if (['assigned', 'running'].includes(task.status)) {
        return { ...task, status: 'ready', error: 'Recovered after application restart.' };
      }
      return task;
    });
    this.workflows.set(restored.id, restored);
    this.schedule(restored);
    return copyWorkflow(restored);
  }

  approveTask(workflowId: string, taskId: string): boolean {
    const task = this.requireTask(workflowId, taskId);
    if (!task.requiresApproval || task.approved || terminalTaskStates.has(task.status)) return false;
    task.approved = true;
    task.error = undefined;
    this.emitTask(task);
    this.schedule(this.requireWorkflow(workflowId));
    return true;
  }

  assignTask(workflowId: string, taskId: string, messageId: string): boolean {
    const task = this.requireTask(workflowId, taskId);
    if (task.status !== 'ready' || (task.requiresApproval && !task.approved)) return false;
    task.status = 'assigned';
    task.messageId = messageId;
    task.attempts += 1;
    task.error = undefined;
    this.emitTask(task);
    this.updateWorkflow(this.requireWorkflow(workflowId));
    return true;
  }

  taskRunning(workflowId: string, taskId: string): boolean {
    const task = this.requireTask(workflowId, taskId);
    if (!['assigned', 'running'].includes(task.status)) return false;
    task.status = 'running';
    this.emitTask(task);
    this.updateWorkflow(this.requireWorkflow(workflowId));
    return true;
  }

  submitResult(workflowId: string, taskId: string, result: WorkflowTaskResult): boolean {
    if (!this.submitForReview(workflowId, taskId, result)) return false;
    return this.completeReview(workflowId, taskId);
  }

  submitForReview(workflowId: string, taskId: string, result: WorkflowTaskResult): boolean {
    const task = this.requireTask(workflowId, taskId);
    if (!['assigned', 'running', 'reviewing'].includes(task.status)) return false;
    task.status = 'reviewing';
    task.summary = result.summary;
    task.artifacts = [...(result.artifacts || [])];
    this.emitTask(task);
    const validationError = this.validateResult(task, result);
    if (validationError) {
      this.failTask(workflowId, taskId, validationError);
      return false;
    }
    return true;
  }

  completeReview(workflowId: string, taskId: string): boolean {
    const task = this.requireTask(workflowId, taskId);
    if (task.status !== 'reviewing') return false;
    task.status = 'completed';
    task.error = undefined;
    this.emitTask(task);
    this.schedule(this.requireWorkflow(workflowId));
    return true;
  }

  updateWorktree(workflowId: string, taskId: string, worktree: CodingWorktreeSummary): boolean {
    const task = this.requireTask(workflowId, taskId);
    task.worktree = { ...worktree, changedFiles: [...worktree.changedFiles] };
    task.error = worktree.error;
    this.emitTask(task);
    this.updateWorkflow(this.requireWorkflow(workflowId));
    return true;
  }

  setTaskPromptVersion(workflowId: string, taskId: string, promptVersion: number): boolean {
    const task = this.requireTask(workflowId, taskId);
    task.promptVersion = promptVersion;
    this.emitTask(task);
    this.updateWorkflow(this.requireWorkflow(workflowId));
    return true;
  }

  failTask(workflowId: string, taskId: string, error: string): boolean {
    const workflow = this.requireWorkflow(workflowId);
    const task = this.requireTask(workflowId, taskId);
    if (terminalTaskStates.has(task.status)) return false;
    task.error = error;
    if (task.failurePolicy === 'retry' && task.attempts < (task.maxAttempts || 1)) {
      task.status = 'ready';
      task.messageId = undefined;
      this.emitTask(task);
      this.schedule(workflow);
      return true;
    }
    task.status = 'failed';
    this.emitTask(task);
    if (task.failurePolicy === 'cancel-workflow') {
      this.cancel(workflowId, `Task ${taskId} failed: ${error}`);
      return true;
    }
    this.schedule(workflow);
    return true;
  }

  reassignTask(workflowId: string, taskId: string, owner: string): boolean {
    const task = this.requireTask(workflowId, taskId);
    if (!['failed', 'cancelled'].includes(task.status) || !owner.trim()) return false;
    task.owner = owner.trim();
    task.status = 'ready';
    task.messageId = undefined;
    task.error = undefined;
    this.emitTask(task);
    this.schedule(this.requireWorkflow(workflowId));
    return true;
  }

  retryTask(workflowId: string, taskId: string): boolean {
    const task = this.requireTask(workflowId, taskId);
    if (task.status !== 'failed') return false;
    task.status = 'ready';
    task.messageId = undefined;
    task.error = undefined;
    this.emitTask(task);
    this.schedule(this.requireWorkflow(workflowId));
    return true;
  }

  cancel(workflowId: string, reason = 'Workflow cancelled.'): boolean {
    const workflow = this.requireWorkflow(workflowId);
    if (['completed', 'cancelled'].includes(workflow.status)) return false;
    workflow.tasks.forEach((task) => {
      if (!terminalTaskStates.has(task.status)) {
        task.status = 'cancelled';
        task.error = reason;
        this.emitTask(task);
      }
    });
    workflow.status = 'cancelled';
    workflow.updatedAt = this.now();
    this.emitWorkflow(workflow);
    return true;
  }

  get(workflowId: string): WorkflowRecord | undefined {
    const workflow = this.workflows.get(workflowId);
    return workflow ? copyWorkflow(workflow) : undefined;
  }

  values(): WorkflowRecord[] {
    return [...this.workflows.values()].map(copyWorkflow);
  }

  private schedule(workflow: WorkflowRecord) {
    if (workflow.status === 'cancelled') return;
    for (const task of workflow.tasks) {
      if (terminalTaskStates.has(task.status) || ['assigned', 'running', 'reviewing'].includes(task.status)) continue;
      const dependencies = task.dependencies.map((id) => workflow.tasks.find((candidate) => candidate.id === id)!);
      if (dependencies.some((dependency) => ['failed', 'cancelled'].includes(dependency.status))) {
        task.status = 'blocked';
        task.error = 'A prerequisite task failed or was cancelled.';
        this.emitTask(task);
        continue;
      }
      const nextStatus: WorkflowTaskStatus = dependencies.every((dependency) => dependency.status === 'completed')
        ? 'ready'
        : 'blocked';
      if (task.status !== nextStatus) {
        task.status = nextStatus;
        task.error = undefined;
        this.emitTask(task);
      }
    }
    this.updateWorkflow(workflow);
    workflow.tasks
      .filter((task) => task.status === 'ready' && !task.messageId && (!task.requiresApproval || task.approved))
      .forEach((task) => this.callbacks.onDispatch?.(copyTask(task)));
  }

  private updateWorkflow(workflow: WorkflowRecord) {
    const statuses = workflow.tasks.map((task) => task.status);
    if (statuses.every((status) => status === 'completed')) workflow.status = 'completed';
    else if (statuses.some((status) => ['assigned', 'running', 'reviewing', 'ready'].includes(status))) workflow.status = 'running';
    else if (statuses.some((status) => status === 'failed')) workflow.status = 'failed';
    else workflow.status = 'planned';
    workflow.updatedAt = this.now();
    this.emitWorkflow(workflow);
  }

  private validateResult(task: WorkflowTaskRecord, result: WorkflowTaskResult): string | undefined {
    const criteria = task.completionCriteria;
    if (!criteria) return undefined;
    const artifacts = new Set(result.artifacts || []);
    const missingArtifact = (criteria.requiredArtifacts || []).find((artifact) => !artifacts.has(artifact));
    if (missingArtifact) return `Completion criteria failed: missing artifact ${missingArtifact}.`;
    const summary = result.summary || '';
    const missingSummary = (criteria.summaryIncludes || []).find((text) => !summary.includes(text));
    if (missingSummary) return `Completion criteria failed: summary does not include "${missingSummary}".`;
    return undefined;
  }

  private validate(definition: WorkflowDefinition | WorkflowRecord) {
    if (!definition.id?.trim() || !definition.name?.trim() || !definition.goal?.trim() || !definition.createdBy?.trim()) {
      throw new WorkflowValidationError('Workflow id, name, goal, and createdBy are required.');
    }
    if (!Array.isArray(definition.tasks) || definition.tasks.length === 0) {
      throw new WorkflowValidationError('Workflow must contain at least one task.');
    }
    const ids = new Set<string>();
    definition.tasks.forEach((task) => {
      if (!task.id?.trim() || !task.owner?.trim() || !task.goal?.trim()) {
        throw new WorkflowValidationError('Every workflow task requires id, owner, and goal.');
      }
      if (task.dependencies !== undefined && !Array.isArray(task.dependencies)) {
        throw new WorkflowValidationError(`Task ${task.id} dependencies must be an array.`);
      }
      if (task.maxAttempts !== undefined && (!Number.isInteger(task.maxAttempts) || task.maxAttempts < 1)) {
        throw new WorkflowValidationError(`Task ${task.id} maxAttempts must be a positive integer.`);
      }
      if (task.failurePolicy && !['block', 'retry', 'cancel-workflow'].includes(task.failurePolicy)) {
        throw new WorkflowValidationError(`Task ${task.id} has an unsupported failure policy.`);
      }
      if (
        task.coding?.files !== undefined &&
        (
          !Array.isArray(task.coding.files) ||
          task.coding.files.some((file) =>
            typeof file !== 'string' ||
            !file.trim() ||
            file.startsWith('/') ||
            file.replace(/\\/g, '/').split('/').includes('..')
          )
        )
      ) {
        throw new WorkflowValidationError(`Task ${task.id} coding files must be project-relative paths.`);
      }
      if (task.coding && (typeof task.coding.testCommand !== 'string' || !task.coding.testCommand.trim())) {
        throw new WorkflowValidationError(`Task ${task.id} coding tasks require a non-empty testCommand.`);
      }
      if (
        task.requiredCapabilities !== undefined &&
        (!Array.isArray(task.requiredCapabilities) ||
          task.requiredCapabilities.some((capability) => typeof capability !== 'string' || !capability.trim()))
      ) {
        throw new WorkflowValidationError(`Task ${task.id} requiredCapabilities must be an array of non-empty strings.`);
      }
      if (
        task.requiredTools !== undefined &&
        (!Array.isArray(task.requiredTools) ||
          task.requiredTools.some((tool) => typeof tool !== 'string' || !tool.trim()))
      ) {
        throw new WorkflowValidationError(`Task ${task.id} requiredTools must be an array of non-empty strings.`);
      }
      if (
        task.completionCriteria?.requiredArtifacts !== undefined &&
        (!Array.isArray(task.completionCriteria.requiredArtifacts) ||
          task.completionCriteria.requiredArtifacts.some((artifact) => typeof artifact !== 'string'))
      ) {
        throw new WorkflowValidationError(`Task ${task.id} requiredArtifacts must be an array of strings.`);
      }
      if (
        task.completionCriteria?.summaryIncludes !== undefined &&
        (!Array.isArray(task.completionCriteria.summaryIncludes) ||
          task.completionCriteria.summaryIncludes.some((text) => typeof text !== 'string'))
      ) {
        throw new WorkflowValidationError(`Task ${task.id} summaryIncludes must be an array of strings.`);
      }
      if (ids.has(task.id)) throw new WorkflowValidationError(`Duplicate task id ${task.id}.`);
      ids.add(task.id);
    });
    definition.tasks.forEach((task) => {
      (task.dependencies || []).forEach((dependency) => {
        if (!ids.has(dependency)) throw new WorkflowValidationError(`Task ${task.id} has unknown dependency ${dependency}.`);
        if (dependency === task.id) throw new WorkflowValidationError(`Task ${task.id} cannot depend on itself.`);
      });
    });
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const byId = new Map(definition.tasks.map((task) => [task.id, task]));
    const visit = (taskId: string) => {
      if (visiting.has(taskId)) throw new WorkflowValidationError('Workflow task dependencies must be acyclic.');
      if (visited.has(taskId)) return;
      visiting.add(taskId);
      (byId.get(taskId)?.dependencies || []).forEach(visit);
      visiting.delete(taskId);
      visited.add(taskId);
    };
    definition.tasks.forEach((task) => visit(task.id));
  }

  private requireWorkflow(workflowId: string): WorkflowRecord {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Unknown workflow ${workflowId}.`);
    return workflow;
  }

  private requireTask(workflowId: string, taskId: string): WorkflowTaskRecord {
    const task = this.requireWorkflow(workflowId).tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Unknown workflow task ${workflowId}/${taskId}.`);
    return task;
  }

  private emitTask(task: WorkflowTaskRecord) {
    this.callbacks.onTaskUpdate?.(copyTask(task));
  }

  private emitWorkflow(workflow: WorkflowRecord) {
    this.callbacks.onWorkflowUpdate?.(copyWorkflow(workflow));
  }
}
