import type { AgentModelProfile, TaskRoutingConstraints } from './modelRouting.ts';
import { routeTaskToModel } from './modelRouting.ts';
import type { WorkflowRecord, WorkflowTaskRecord } from './workflowCore';

export type RecommendationConfidence = 'low' | 'medium' | 'high';

export interface ModelRecommendationEvidence {
  agentId: string;
  model: string;
  successfulTasks: number;
  averageCostUsd: number;
  averageDurationMs?: number;
}

export interface ModelRecommendation extends ModelRecommendationEvidence {
  confidence: RecommendationConfidence;
  reason: string;
  alternatives: ModelRecommendationEvidence[];
}

const normalized = (values: string[] = []) =>
  [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();

export const getTaskRecommendationKey = (
  task: Pick<WorkflowTaskRecord, 'coding' | 'requiredCapabilities' | 'requiredTools' | 'routing'>,
): string => JSON.stringify({
  coding: Boolean(task.coding),
  capabilities: normalized(task.requiredCapabilities),
  tools: normalized(task.requiredTools),
  localOnly: Boolean(task.routing?.localOnly),
  minCapabilityTier: task.routing?.minCapabilityTier || 0,
  minContextWindow: task.routing?.minContextWindow || 0,
});

const confidenceFor = (successfulTasks: number): RecommendationConfidence => {
  if (successfulTasks >= 5) return 'high';
  if (successfulTasks >= 2) return 'medium';
  return 'low';
};

const isEligible = (
  profile: AgentModelProfile,
  constraints: TaskRoutingConstraints | undefined,
  requiredCapabilities: string[] | undefined,
  requiredTools: string[] | undefined,
) => {
  try {
    routeTaskToModel({
      profiles: [profile],
      constraints: { ...constraints, candidateOwners: [profile.agentId], fallbackOwners: undefined },
      requiredCapabilities,
      requiredTools,
    });
    return true;
  } catch {
    return false;
  }
};

export const recommendModelForTask = ({
  workflows,
  profiles,
  task,
  exclude,
}: {
  workflows: WorkflowRecord[];
  profiles: AgentModelProfile[];
  task: WorkflowTaskRecord;
  exclude?: { workflowId: string; taskId: string };
}): ModelRecommendation | undefined => {
  const targetKey = getTaskRecommendationKey(task);
  const eligibleProfiles = new Map(profiles
    .filter((profile) => isEligible(profile, task.routing, task.requiredCapabilities, task.requiredTools))
    .map((profile) => [profile.agentId, profile]));
  const evidence = new Map<string, { costs: number[]; durations: number[] }>();

  workflows.forEach((workflow) => workflow.tasks.forEach((historicalTask) => {
    if (
      historicalTask.status !== 'completed' ||
      !historicalTask.routingDecision ||
      getTaskRecommendationKey(historicalTask) !== targetKey ||
      (exclude?.workflowId === workflow.id && exclude.taskId === historicalTask.id)
    ) return;
    const profile = eligibleProfiles.get(historicalTask.routingDecision.selectedAgentId);
    if (!profile || profile.model !== historicalTask.routingDecision.selectedModel) return;
    const record = evidence.get(profile.agentId) || { costs: [], durations: [] };
    record.costs.push(historicalTask.usage?.actualCostUsd ?? historicalTask.routingDecision.estimatedCostUsd);
    if (historicalTask.assignedAt !== undefined && historicalTask.completedAt !== undefined) {
      record.durations.push(Math.max(0, historicalTask.completedAt - historicalTask.assignedAt));
    }
    evidence.set(profile.agentId, record);
  }));

  const candidates = [...evidence.entries()].map(([agentId, record]): ModelRecommendationEvidence => {
    const profile = eligibleProfiles.get(agentId)!;
    return {
      agentId,
      model: profile.model,
      successfulTasks: record.costs.length,
      averageCostUsd: Number((record.costs.reduce((sum, cost) => sum + cost, 0) / record.costs.length).toFixed(6)),
      averageDurationMs: record.durations.length > 0
        ? Math.round(record.durations.reduce((sum, duration) => sum + duration, 0) / record.durations.length)
        : undefined,
    };
  }).sort((left, right) =>
    left.averageCostUsd - right.averageCostUsd ||
    right.successfulTasks - left.successfulTasks ||
    (left.averageDurationMs ?? Infinity) - (right.averageDurationMs ?? Infinity) ||
    left.agentId.localeCompare(right.agentId)
  );
  const selected = candidates[0];
  if (!selected) return undefined;
  const confidence = confidenceFor(selected.successfulTasks);
  return {
    ...selected,
    confidence,
    reason: `${selected.model} completed ${selected.successfulTasks} matching task${selected.successfulTasks === 1 ? '' : 's'} at an average cost of $${selected.averageCostUsd.toFixed(4)}.`,
    alternatives: candidates.slice(1),
  };
};
