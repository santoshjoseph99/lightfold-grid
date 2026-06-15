import type { AgentModelProfile, TaskRoutingConstraints } from './modelRouting';
import type { WorkflowRecord } from './workflowCore';

export interface WorkflowBudget {
  maxEstimatedCostUsd?: number;
  maxCloudEstimatedCostUsd?: number;
  maxCloudAssignments?: number;
}

export interface WorkflowBudgetUsage {
  estimatedCostUsd: number;
  cloudEstimatedCostUsd: number;
  cloudAssignments: number;
  actualCostUsd: number;
}

const rounded = (value: number) => Number(Math.max(0, value).toFixed(6));

export const calculateWorkflowBudgetUsage = (
  workflow: WorkflowRecord,
  profiles: AgentModelProfile[] = [],
): WorkflowBudgetUsage => {
  const privacy = new Map(profiles.map((profile) => [profile.agentId, profile.privacy]));
  let estimatedCostUsd = 0;
  let cloudEstimatedCostUsd = 0;
  let cloudAssignments = 0;
  let actualCostUsd = 0;
  workflow.tasks.forEach((task) => {
    actualCostUsd += task.usage?.actualCostUsd || 0;
  });
  const reservations = workflow.budgetReservations?.length
    ? workflow.budgetReservations.map((reservation) => reservation.decision)
    : workflow.tasks.flatMap((task) => task.routingHistory || []);
  reservations.forEach((decision) => {
    estimatedCostUsd += decision.estimatedCostUsd;
    if (decision.selectedPrivacy === 'cloud' || privacy.get(decision.selectedAgentId) === 'cloud') {
      cloudEstimatedCostUsd += decision.estimatedCostUsd;
      cloudAssignments += 1;
    }
  });
  return {
    estimatedCostUsd: rounded(estimatedCostUsd),
    cloudEstimatedCostUsd: rounded(cloudEstimatedCostUsd),
    cloudAssignments,
    actualCostUsd: rounded(actualCostUsd),
  };
};

export const applyWorkflowBudget = (
  workflow: WorkflowRecord,
  constraints: TaskRoutingConstraints = {},
  profiles: AgentModelProfile[] = [],
): TaskRoutingConstraints => {
  if (!workflow.budget) return { ...constraints };
  const usage = calculateWorkflowBudgetUsage(workflow, profiles);
  const next = { ...constraints };
  if (workflow.budget.maxEstimatedCostUsd !== undefined) {
    const remaining = rounded(workflow.budget.maxEstimatedCostUsd - usage.estimatedCostUsd);
    next.maxEstimatedCostUsd = next.maxEstimatedCostUsd === undefined
      ? remaining
      : Math.min(next.maxEstimatedCostUsd, remaining);
  }
  if (workflow.budget.maxCloudEstimatedCostUsd !== undefined) {
    const remaining = rounded(workflow.budget.maxCloudEstimatedCostUsd - usage.cloudEstimatedCostUsd);
    next.maxCloudEstimatedCostUsd = next.maxCloudEstimatedCostUsd === undefined
      ? remaining
      : Math.min(next.maxCloudEstimatedCostUsd, remaining);
  }
  if (
    workflow.budget.maxCloudAssignments !== undefined &&
    usage.cloudAssignments >= workflow.budget.maxCloudAssignments
  ) {
    next.localOnly = true;
  }
  return next;
};
