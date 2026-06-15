export type ModelPrivacy = 'local' | 'cloud' | 'user-defined';
export type ModelCapabilityTier = 1 | 2 | 3 | 4 | 5;

export interface AgentModelProfile {
  agentId: string;
  model: string;
  privacy: ModelPrivacy;
  capabilityTier: ModelCapabilityTier;
  contextWindow?: number;
  toolSupport?: boolean;
  inputCostPerMillionTokens: number;
  outputCostPerMillionTokens: number;
  expectedLatencyMs?: number;
  capabilities: string[];
  tools: string[];
}

export interface TaskRoutingConstraints {
  localOnly?: boolean;
  maxEstimatedCostUsd?: number;
  maxCloudEstimatedCostUsd?: number;
  minCapabilityTier?: ModelCapabilityTier;
  minContextWindow?: number;
  candidateOwners?: string[];
  fallbackOwners?: string[];
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
}

export interface RoutingCandidateEvaluation {
  agentId: string;
  model: string;
  eligible: boolean;
  estimatedCostUsd: number;
  reasons: string[];
}

export interface RoutingDecision {
  selectedAgentId: string;
  selectedModel: string;
  selectedPrivacy?: ModelPrivacy;
  estimatedCostUsd: number;
  strongestModelCostUsd: number;
  estimatedSavingsUsd: number;
  reason: string;
  escalation: number;
  evaluatedAt: number;
  candidates: RoutingCandidateEvaluation[];
}

export interface ModelUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  actualCostUsd?: number;
}

const normalized = (values: string[] = []) => new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));

export const estimateModelCost = (
  profile: AgentModelProfile,
  constraints: TaskRoutingConstraints = {},
): number => {
  const inputTokens = constraints.estimatedInputTokens || 0;
  const outputTokens = constraints.estimatedOutputTokens || 0;
  return Number((
    (inputTokens / 1_000_000) * profile.inputCostPerMillionTokens +
    (outputTokens / 1_000_000) * profile.outputCostPerMillionTokens
  ).toFixed(6));
};

export const routeTaskToModel = ({
  profiles,
  constraints = {},
  requiredCapabilities = [],
  requiredTools = [],
  previousOwners = [],
  now = Date.now,
}: {
  profiles: AgentModelProfile[];
  constraints?: TaskRoutingConstraints;
  requiredCapabilities?: string[];
  requiredTools?: string[];
  previousOwners?: string[];
  now?: () => number;
}): RoutingDecision => {
  const allowedOwners = constraints.fallbackOwners?.length
    ? constraints.fallbackOwners
    : constraints.candidateOwners?.length
      ? constraints.candidateOwners
      : profiles.map((profile) => profile.agentId);
  const allowed = new Set(allowedOwners);
  const previous = new Set(previousOwners);
  const requiredCapabilitySet = normalized(requiredCapabilities);
  const requiredToolSet = normalized(requiredTools);
  const candidates = profiles
    .filter((profile) => allowed.has(profile.agentId))
    .map((profile): RoutingCandidateEvaluation => {
      const reasons: string[] = [];
      const capabilities = normalized(profile.capabilities);
      const tools = normalized(profile.tools);
      if (previous.has(profile.agentId)) reasons.push('already attempted');
      if (constraints.localOnly && profile.privacy !== 'local') reasons.push('cloud use is forbidden');
      if (constraints.minCapabilityTier && profile.capabilityTier < constraints.minCapabilityTier) {
        reasons.push(`capability tier ${profile.capabilityTier} is below ${constraints.minCapabilityTier}`);
      }
      if (constraints.minContextWindow && (!profile.contextWindow || profile.contextWindow < constraints.minContextWindow)) {
        reasons.push(`context window is below ${constraints.minContextWindow}`);
      }
      if ([...requiredCapabilitySet].some((capability) => !capabilities.has(capability))) {
        reasons.push('missing required capabilities');
      }
      if (requiredToolSet.size > 0 && profile.toolSupport === false) reasons.push('adapter does not support tools');
      if ([...requiredToolSet].some((tool) => !tools.has(tool))) reasons.push('missing required tools');
      const estimatedCostUsd = estimateModelCost(profile, constraints);
      if (constraints.maxEstimatedCostUsd !== undefined && estimatedCostUsd > constraints.maxEstimatedCostUsd) {
        reasons.push(`estimated cost $${estimatedCostUsd.toFixed(4)} exceeds budget`);
      }
      if (
        profile.privacy === 'cloud' &&
        constraints.maxCloudEstimatedCostUsd !== undefined &&
        estimatedCostUsd > constraints.maxCloudEstimatedCostUsd
      ) {
        reasons.push(`cloud estimated cost $${estimatedCostUsd.toFixed(4)} exceeds cloud budget`);
      }
      return {
        agentId: profile.agentId,
        model: profile.model,
        eligible: reasons.length === 0,
        estimatedCostUsd,
        reasons,
      };
    });
  const eligible = candidates.filter((candidate) => candidate.eligible);
  const selected = constraints.fallbackOwners?.length
    ? eligible.sort((left, right) => allowedOwners.indexOf(left.agentId) - allowedOwners.indexOf(right.agentId))[0]
    : eligible.sort((left, right) => {
        if (left.estimatedCostUsd !== right.estimatedCostUsd) return left.estimatedCostUsd - right.estimatedCostUsd;
        const leftProfile = profiles.find((profile) => profile.agentId === left.agentId)!;
        const rightProfile = profiles.find((profile) => profile.agentId === right.agentId)!;
        if (leftProfile.capabilityTier !== rightProfile.capabilityTier) return leftProfile.capabilityTier - rightProfile.capabilityTier;
        return (leftProfile.expectedLatencyMs || Infinity) - (rightProfile.expectedLatencyMs || Infinity);
      })[0];
  if (!selected) {
    const detail = candidates.map((candidate) =>
      `${candidate.agentId}: ${candidate.reasons.join(', ') || 'not eligible'}`,
    ).join('; ');
    throw new Error(`No model satisfies task routing constraints.${detail ? ` ${detail}` : ''}`);
  }
  const strongestProfile = profiles
    .filter((profile) => eligible.some((candidate) => candidate.agentId === profile.agentId))
    .sort((left, right) => right.capabilityTier - left.capabilityTier)[0];
  const strongestCost = estimateModelCost(strongestProfile, constraints);
  const escalation = previousOwners.length;
  return {
    selectedAgentId: selected.agentId,
    selectedModel: selected.model,
    selectedPrivacy: profiles.find((profile) => profile.agentId === selected.agentId)!.privacy,
    estimatedCostUsd: selected.estimatedCostUsd,
    strongestModelCostUsd: strongestCost,
    estimatedSavingsUsd: Number(Math.max(0, strongestCost - selected.estimatedCostUsd).toFixed(6)),
    reason: constraints.fallbackOwners?.length
      ? `Selected fallback ${escalation + 1} of ${constraints.fallbackOwners.length}.`
      : `Selected the least expensive eligible model from ${eligible.length} candidate${eligible.length === 1 ? '' : 's'}.`,
    escalation,
    evaluatedAt: now(),
    candidates,
  };
};
