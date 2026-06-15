import type { AgentLifecycleRecord } from './brokerCore';
import type { StarlightMessage } from './brokerProtocol';
import type { WorkflowRecord } from './workflowCore';

export interface BrokerEvent {
  sequence: number;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  createdAt: number;
}

export interface BrokerObservabilitySnapshot {
  agents: AgentLifecycleRecord[];
  messages: StarlightMessage[];
  workflows: WorkflowRecord[];
  events: BrokerEvent[];
}

export interface BrokerMetrics {
  queueDepth: number;
  averageDeliveryLatencyMs: number;
  averageTaskDurationMs: number;
  retries: number;
  failures: number;
  agentUptimePercent: number;
  estimatedModelCostUsd: number;
  estimatedSavingsUsd: number;
  escalations: number;
  promptTokens: number;
  completionTokens: number;
  reportedModelCostUsd: number;
}

const average = (values: number[]) =>
  values.length === 0 ? 0 : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);

export const calculateBrokerMetrics = (snapshot: BrokerObservabilitySnapshot): BrokerMetrics => {
  const deliveryLatencies = snapshot.messages
    .filter((message) => message.kind === 'request' && message.deliveredAt !== undefined)
    .map((message) => Math.max(0, message.deliveredAt! - message.timestamp));
  const taskDurations = snapshot.messages
    .filter((message) => message.kind === 'request' && message.completedAt !== undefined)
    .map((message) => Math.max(0, message.completedAt! - (message.acknowledgedAt || message.timestamp)));
  const availableAgents = snapshot.agents.filter((agent) => ['ready', 'busy'].includes(agent.state)).length;
  return {
    queueDepth: snapshot.messages.filter((message) => ['pending', 'queued', 'delivering'].includes(message.status)).length,
    averageDeliveryLatencyMs: average(deliveryLatencies),
    averageTaskDurationMs: average(taskDurations),
    retries: snapshot.messages.reduce((sum, message) => sum + Math.max(0, message.attempt - 1), 0),
    failures: snapshot.messages.filter((message) => message.status === 'failed').length +
      snapshot.workflows.filter((workflow) => workflow.status === 'failed').length,
    agentUptimePercent: snapshot.agents.length === 0 ? 0 : Math.round((availableAgents / snapshot.agents.length) * 100),
    estimatedModelCostUsd: Number(snapshot.workflows.reduce((sum, workflow) =>
      sum + workflow.tasks.reduce((taskSum, task) =>
        taskSum + (task.routingHistory || []).reduce((historySum, decision) => historySum + decision.estimatedCostUsd, 0), 0), 0).toFixed(6)),
    estimatedSavingsUsd: Number(snapshot.workflows.reduce((sum, workflow) =>
      sum + workflow.tasks.reduce((taskSum, task) =>
        taskSum + (task.routingHistory || []).reduce((historySum, decision) => historySum + decision.estimatedSavingsUsd, 0), 0), 0).toFixed(6)),
    escalations: snapshot.workflows.reduce((sum, workflow) =>
      sum + workflow.tasks.reduce((taskSum, task) => taskSum + Math.max(0, (task.routingHistory || []).length - 1), 0), 0),
    promptTokens: snapshot.workflows.reduce((sum, workflow) =>
      sum + workflow.tasks.reduce((taskSum, task) => taskSum + (task.usage?.promptTokens || 0), 0), 0),
    completionTokens: snapshot.workflows.reduce((sum, workflow) =>
      sum + workflow.tasks.reduce((taskSum, task) => taskSum + (task.usage?.completionTokens || 0), 0), 0),
    reportedModelCostUsd: Number(snapshot.workflows.reduce((sum, workflow) =>
      sum + workflow.tasks.reduce((taskSum, task) => taskSum + (task.usage?.actualCostUsd || 0), 0), 0).toFixed(6)),
  };
};

export const getCorrelatedMessageChain = (messages: StarlightMessage[], message: StarlightMessage): StarlightMessage[] => {
  const rootId = message.kind === 'request' ? message.messageId : message.correlationId;
  return messages
    .filter((candidate) => (
      candidate.messageId === rootId ||
      candidate.correlationId === rootId ||
      candidate.taskId === message.taskId
    ))
    .sort((left, right) => left.timestamp - right.timestamp);
};

export const getWorkflowTimeline = (workflow: WorkflowRecord, events: BrokerEvent[]): BrokerEvent[] => {
  const taskIds = new Set(workflow.tasks.map((task) => task.id));
  const messageIds = new Set(workflow.tasks.flatMap((task) => task.messageId ? [task.messageId] : []));
  return events.filter((event) => (
    event.entityId === workflow.id ||
    taskIds.has(event.entityId) ||
    messageIds.has(event.entityId) ||
    (typeof event.payload === 'object' && event.payload !== null &&
      (event.payload as Record<string, unknown>).workflowId === workflow.id)
  ));
};

export const formatDuration = (durationMs: number) => {
  if (durationMs < 1_000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)}s`;
  return `${(durationMs / 60_000).toFixed(1)}m`;
};
