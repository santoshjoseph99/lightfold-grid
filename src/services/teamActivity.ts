import type { AgentLifecycleState } from './brokerCore.ts';
import type { StarlightMessage } from './brokerProtocol.ts';
import type { BrokerEvent, BrokerObservabilitySnapshot } from './observability.ts';
import { calculateWorkflowBudgetUsage } from './workflowBudget.ts';
import type { WorkflowRecord, WorkflowTaskRecord, WorkflowTaskStatus } from './workflowCore.ts';

export type TeamMessageMode = 'stream' | 'graph';
export type TeamSeverity = 'info' | 'warning' | 'error' | 'success';

export interface TeamRoomControls {
  replacesOpsPanel: true;
  messageModes: TeamMessageMode[];
  defaultMessageMode: TeamMessageMode;
  workflowOnly: true;
  allowTerminalSummaries: true;
  supportsAgentColorsAndIcons: true;
}

export interface TeamAgentSummary {
  agentId: string;
  role: string;
  state: AgentLifecycleState | 'unknown';
  icon: string;
  color: string;
  currentTaskId?: string;
  currentTask?: {
    workflowId: string;
    taskId: string;
    goal: string;
    status: WorkflowTaskStatus;
  };
  queueDepth: number;
  lastActivity?: string;
  lastHeartbeatAt?: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  promptTokens: number;
  completionTokens: number;
}

export interface TeamMessageFlowEntry {
  messageId: string;
  workflowId: string;
  taskId: string;
  from: string;
  to: string;
  kind: StarlightMessage['kind'];
  status: StarlightMessage['status'];
  attempt: number;
  severity: TeamSeverity;
  summary: string;
  timestamp: number;
  correlationId?: string;
}

export interface TeamMessageGraphEdge {
  id: string;
  from: string;
  to: string;
  messageId: string;
  taskId: string;
  kind: StarlightMessage['kind'];
  severity: TeamSeverity;
}

export interface TeamTaskCard {
  workflowId: string;
  taskId: string;
  owner: string;
  goal: string;
  status: WorkflowTaskStatus;
  dependencies: string[];
  requiresApproval: boolean;
  approved: boolean;
  blockedReason?: string;
  routing?: {
    selectedAgentId: string;
    selectedModel: string;
    selectedPrivacy?: string;
    estimatedCostUsd: number;
    estimatedSavingsUsd: number;
    escalation: number;
    reason: string;
  };
  worktree?: {
    branch: string;
    worktreePath: string;
    changedFiles: string[];
    status: string;
  };
  artifacts: string[];
}

export interface TeamWorkflowBoardColumn {
  id: WorkflowTaskStatus | 'failed-cancelled';
  label: string;
  tasks: TeamTaskCard[];
}

export interface TeamTimelineEntry {
  id: string;
  workflowId?: string;
  agentId?: string;
  taskId?: string;
  messageId?: string;
  label: string;
  detail: string;
  severity: TeamSeverity;
  createdAt: number;
  source: 'event' | 'message' | 'workflow';
}

export interface TeamModelCostSummary {
  workflowId: string;
  workflowName: string;
  estimatedCostUsd: number;
  actualCostUsd: number;
  estimatedSavingsUsd: number;
  budgetRemainingUsd?: number;
  cloudAssignments: number;
  escalations: number;
  routedTasks: Array<{
    taskId: string;
    owner: string;
    model: string;
    privacy?: string;
    estimatedCostUsd: number;
    estimatedSavingsUsd: number;
    escalation: number;
  }>;
}

export interface TeamActivitySnapshot {
  controls: TeamRoomControls;
  agents: TeamAgentSummary[];
  messageFlow: {
    mode: TeamMessageMode;
    stream: TeamMessageFlowEntry[];
    graph: {
      nodes: Array<{ id: string; label: string }>;
      edges: TeamMessageGraphEdge[];
    };
  };
  workflowBoard: TeamWorkflowBoardColumn[];
  timeline: TeamTimelineEntry[];
  modelCosts: TeamModelCostSummary[];
}

const columns: Array<{ id: TeamWorkflowBoardColumn['id']; label: string; statuses: WorkflowTaskStatus[] }> = [
  { id: 'planned', label: 'Planned', statuses: ['planned'] },
  { id: 'blocked', label: 'Blocked', statuses: ['blocked'] },
  { id: 'ready', label: 'Ready', statuses: ['ready'] },
  { id: 'running', label: 'Running', statuses: ['assigned', 'running'] },
  { id: 'reviewing', label: 'Reviewing', statuses: ['reviewing'] },
  { id: 'completed', label: 'Completed', statuses: ['completed'] },
  { id: 'failed-cancelled', label: 'Failed or Cancelled', statuses: ['failed', 'cancelled'] },
];

const defaultColors = [
  '#67e8f9',
  '#a78bfa',
  '#34d399',
  '#fbbf24',
  '#fb7185',
  '#60a5fa',
];

const defaultIcons = ['spark', 'compass', 'hammer', 'test-tube', 'shield', 'rocket'];

const severityForStatus = (status: string): TeamSeverity => {
  if (['failed', 'cancelled', 'error'].includes(status)) return 'error';
  if (['blocked', 'unresponsive', 'queued', 'delivering'].includes(status)) return 'warning';
  if (['completed', 'ready', 'acknowledged'].includes(status)) return 'success';
  return 'info';
};

const messageSummary = (message: StarlightMessage) =>
  message.payload.summary ||
  message.payload.instruction ||
  message.command ||
  message.error ||
  `${message.kind} from ${message.from} to ${message.to}`;

const taskMatchesMessage = (task: WorkflowTaskRecord, message: StarlightMessage) =>
  (task.messageId !== undefined && task.messageId === message.messageId) ||
  (task.messageId !== undefined && message.correlationId !== undefined && task.messageId === message.correlationId) ||
  task.id === message.taskId ||
  (task.messageId !== undefined && task.messageId === message.taskId);

const workflowTaskEntries = (workflows: WorkflowRecord[]) =>
  workflows.flatMap((workflow) => workflow.tasks.map((task) => ({ workflow, task })));

const workflowBackedMessages = (snapshot: BrokerObservabilitySnapshot) => {
  const entries = workflowTaskEntries(snapshot.workflows);
  return snapshot.messages.flatMap((message) => {
    const match = entries.find(({ task }) => taskMatchesMessage(task, message));
    return match ? [{ message, workflow: match.workflow, task: match.task }] : [];
  });
};

const taskCard = (workflow: WorkflowRecord, task: WorkflowTaskRecord): TeamTaskCard => ({
  workflowId: workflow.id,
  taskId: task.id,
  owner: task.owner,
  goal: task.goal,
  status: task.status,
  dependencies: [...task.dependencies],
  requiresApproval: Boolean(task.requiresApproval),
  approved: task.approved,
  blockedReason: task.status === 'blocked' ? task.error || 'Waiting on dependencies.' : task.error,
  routing: task.routingDecision ? {
    selectedAgentId: task.routingDecision.selectedAgentId,
    selectedModel: task.routingDecision.selectedModel,
    selectedPrivacy: task.routingDecision.selectedPrivacy,
    estimatedCostUsd: task.routingDecision.estimatedCostUsd,
    estimatedSavingsUsd: task.routingDecision.estimatedSavingsUsd,
    escalation: task.routingDecision.escalation,
    reason: task.routingDecision.reason,
  } : undefined,
  worktree: task.worktree ? {
    branch: task.worktree.branch,
    worktreePath: task.worktree.worktreePath,
    changedFiles: [...task.worktree.changedFiles],
    status: task.worktree.status,
  } : undefined,
  artifacts: [...task.artifacts],
});

const eventTimelineEntry = (event: BrokerEvent): TeamTimelineEntry => {
  const payload = typeof event.payload === 'object' && event.payload !== null
    ? event.payload as Record<string, unknown>
    : {};
  const status = event.eventType.split('.').pop() || event.eventType;
  return {
    id: `event:${event.sequence}`,
    workflowId: typeof payload.workflowId === 'string' ? payload.workflowId : event.entityType === 'workflow' ? event.entityId : undefined,
    agentId: event.entityType === 'agent' ? event.entityId : undefined,
    taskId: event.entityType === 'task' ? event.entityId : typeof payload.taskId === 'string' ? payload.taskId : undefined,
    messageId: event.entityType === 'message' ? event.entityId : typeof payload.messageId === 'string' ? payload.messageId : undefined,
    label: event.eventType,
    detail: event.entityId,
    severity: severityForStatus(status),
    createdAt: event.createdAt,
    source: 'event',
  };
};

export const createTeamActivitySnapshot = (
  snapshot: BrokerObservabilitySnapshot,
  mode: TeamMessageMode = 'stream',
): TeamActivitySnapshot => {
  const taskEntries = workflowTaskEntries(snapshot.workflows);
  const messages = workflowBackedMessages(snapshot);
  const messagesByTarget = new Map<string, StarlightMessage[]>();
  messages.forEach(({ message }) => {
    messagesByTarget.set(message.to, [...(messagesByTarget.get(message.to) || []), message]);
  });
  const agentIds = [...new Set([
    ...snapshot.agents.map((agent) => agent.agentId),
    ...taskEntries.map(({ task }) => task.owner),
  ])].sort();

  const agents = agentIds.map((agentId, index): TeamAgentSummary => {
    const lifecycle = snapshot.agents.find((agent) => agent.agentId === agentId);
    const activeTask = taskEntries.find(({ task }) => task.owner === agentId && !['completed', 'failed', 'cancelled'].includes(task.status));
    const agentTasks = taskEntries.map(({ task }) => task).filter((task) => task.owner === agentId);
    const routedTasks = agentTasks.filter((task) => task.routingDecision || task.usage);
    const targetMessages = messagesByTarget.get(agentId) || [];
    const lastMessage = [...targetMessages].sort((left, right) => right.timestamp - left.timestamp)[0];
    return {
      agentId,
      role: lifecycle?.role || agentId,
      state: lifecycle?.state || 'unknown',
      icon: defaultIcons[index % defaultIcons.length],
      color: defaultColors[index % defaultColors.length],
      currentTaskId: lifecycle?.currentTaskId || activeTask?.task.id,
      currentTask: activeTask ? {
        workflowId: activeTask.workflow.id,
        taskId: activeTask.task.id,
        goal: activeTask.task.goal,
        status: activeTask.task.status,
      } : undefined,
      queueDepth: targetMessages.filter((message) => ['pending', 'queued', 'delivering'].includes(message.status)).length,
      lastActivity: lastMessage ? messageSummary(lastMessage) : undefined,
      lastHeartbeatAt: lifecycle?.lastHeartbeatAt,
      estimatedCostUsd: Number(routedTasks.reduce((sum, task) => sum + (task.routingDecision?.estimatedCostUsd || 0), 0).toFixed(6)),
      actualCostUsd: Number(routedTasks.reduce((sum, task) => sum + (task.usage?.actualCostUsd || 0), 0).toFixed(6)),
      promptTokens: routedTasks.reduce((sum, task) => sum + (task.usage?.promptTokens || 0), 0),
      completionTokens: routedTasks.reduce((sum, task) => sum + (task.usage?.completionTokens || 0), 0),
    };
  });

  const stream = messages
    .map(({ message, workflow, task }): TeamMessageFlowEntry => ({
      messageId: message.messageId,
      workflowId: workflow.id,
      taskId: task.id,
      from: message.from,
      to: message.to,
      kind: message.kind,
      status: message.status,
      attempt: message.attempt,
      severity: message.status === 'failed' || message.kind === 'error'
        ? 'error'
        : message.attempt > 1
          ? 'warning'
          : severityForStatus(message.status),
      summary: messageSummary(message),
      timestamp: message.timestamp,
      correlationId: message.correlationId,
    }))
    .sort((left, right) => right.timestamp - left.timestamp);

  const graphNodes = agents.map((agent) => ({ id: agent.agentId, label: agent.role }));
  const graphEdges = stream.map((entry): TeamMessageGraphEdge => ({
    id: `${entry.messageId}:${entry.attempt}`,
    from: entry.from,
    to: entry.to,
    messageId: entry.messageId,
    taskId: entry.taskId,
    kind: entry.kind,
    severity: entry.severity,
  }));

  const workflowBoard = columns.map((column): TeamWorkflowBoardColumn => ({
    id: column.id,
    label: column.label,
    tasks: taskEntries
      .filter(({ task }) => column.statuses.includes(task.status))
      .map(({ workflow, task }) => taskCard(workflow, task)),
  }));

  const messageTimeline = stream.map((entry): TeamTimelineEntry => ({
    id: `message:${entry.messageId}:${entry.attempt}`,
    workflowId: entry.workflowId,
    taskId: entry.taskId,
    messageId: entry.messageId,
    agentId: entry.to,
    label: `${entry.kind} ${entry.status}`,
    detail: entry.summary,
    severity: entry.severity,
    createdAt: entry.timestamp,
    source: 'message',
  }));

  const workflowTimeline = taskEntries.map(({ workflow, task }): TeamTimelineEntry => ({
    id: `task:${workflow.id}:${task.id}:${task.status}`,
    workflowId: workflow.id,
    taskId: task.id,
    agentId: task.owner,
    label: `${task.id} ${task.status}`,
    detail: task.error || task.summary || task.goal,
    severity: severityForStatus(task.status),
    createdAt: task.completedAt || task.assignedAt || workflow.updatedAt,
    source: 'workflow',
  }));

  const timeline = [
    ...snapshot.events.map(eventTimelineEntry),
    ...messageTimeline,
    ...workflowTimeline,
  ].sort((left, right) => right.createdAt - left.createdAt);

  const modelCosts = snapshot.workflows.map((workflow): TeamModelCostSummary => {
    const usage = calculateWorkflowBudgetUsage(workflow);
    const estimatedSavingsUsd = Number(workflow.tasks.reduce((sum, task) =>
      sum + (task.routingHistory || []).reduce((historySum, decision) => historySum + decision.estimatedSavingsUsd, 0), 0).toFixed(6));
    const routedTasks = workflow.tasks
      .filter((task) => task.routingDecision)
      .map((task) => ({
        taskId: task.id,
        owner: task.owner,
        model: task.routingDecision!.selectedModel,
        privacy: task.routingDecision!.selectedPrivacy,
        estimatedCostUsd: task.routingDecision!.estimatedCostUsd,
        estimatedSavingsUsd: task.routingDecision!.estimatedSavingsUsd,
        escalation: task.routingDecision!.escalation,
      }));
    return {
      workflowId: workflow.id,
      workflowName: workflow.name,
      estimatedCostUsd: usage.estimatedCostUsd,
      actualCostUsd: usage.actualCostUsd,
      estimatedSavingsUsd,
      budgetRemainingUsd: workflow.budget?.maxEstimatedCostUsd === undefined
        ? undefined
        : Number(Math.max(0, workflow.budget.maxEstimatedCostUsd - usage.estimatedCostUsd).toFixed(6)),
      cloudAssignments: usage.cloudAssignments,
      escalations: workflow.tasks.reduce((sum, task) => sum + Math.max(0, (task.routingHistory || []).length - 1), 0),
      routedTasks,
    };
  });

  return {
    controls: {
      replacesOpsPanel: true,
      messageModes: ['stream', 'graph'],
      defaultMessageMode: 'stream',
      workflowOnly: true,
      allowTerminalSummaries: true,
      supportsAgentColorsAndIcons: true,
    },
    agents,
    messageFlow: {
      mode,
      stream,
      graph: {
        nodes: graphNodes,
        edges: graphEdges,
      },
    },
    workflowBoard,
    timeline,
    modelCosts,
  };
};
