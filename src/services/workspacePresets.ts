import type { AdapterId } from './cliAdapters';

export type RolePresetId = 'orchestrator' | 'planner' | 'builder' | 'tester' | 'reviewer' | 'release';
export type TopologyPresetId = 'solo' | 'wheel' | 'pipeline' | 'review-loop';
export type ProviderPresetId = 'ollama' | 'mixed' | 'gemini' | 'copilot' | 'custom';

export interface PresetAgentConfig {
  paneId: string;
  adapterId?: AdapterId;
  agentName: string;
  cliCommand: string;
  selectedModel: string;
  promptPath: string;
  promptContent: string;
  capabilities: string[];
  tools: string[];
  capabilityTier?: 1 | 2 | 3 | 4 | 5;
  contextWindow?: number;
  inputCostPerMillionTokens?: number;
  outputCostPerMillionTokens?: number;
  expectedLatencyMs?: number;
  yoloMode: boolean;
}

export interface WorkspacePreset {
  paneIds: string[];
  activePaneId: string;
  agentConfigs: Record<string, PresetAgentConfig>;
  connections: Record<string, string[]>;
}

export interface WorkspacePresetOptions {
  provider: ProviderPresetId;
  model: string;
  topology: TopologyPresetId;
  customCommand?: string;
}

export const PROVIDER_PRESETS: Record<ProviderPresetId, { label: string; command: string; defaultModel: string }> = {
  ollama: { label: 'Local Ollama', command: 'ollama run', defaultModel: 'gemma4-32k:latest' },
  mixed: { label: 'Mixed Ollama + Gemini', command: 'ollama run', defaultModel: 'gemma4-32k:latest' },
  gemini: { label: 'Gemini CLI', command: 'gemini', defaultModel: 'auto' },
  copilot: { label: 'GitHub Copilot CLI', command: 'copilot', defaultModel: 'gpt-4o' },
  custom: { label: 'Custom CLI', command: '', defaultModel: 'auto' },
};

export const TOPOLOGY_PRESETS: Record<TopologyPresetId, { label: string; roles: RolePresetId[] }> = {
  solo: { label: 'Solo', roles: ['orchestrator'] },
  wheel: { label: 'Wheel', roles: ['orchestrator', 'builder', 'tester', 'reviewer'] },
  pipeline: { label: 'Pipeline', roles: ['planner', 'builder', 'tester', 'reviewer', 'release'] },
  'review-loop': { label: 'Review Loop', roles: ['orchestrator', 'builder', 'tester', 'reviewer'] },
};

const ROLE_PRESETS: Record<RolePresetId, Omit<PresetAgentConfig, 'paneId' | 'cliCommand' | 'selectedModel' | 'promptPath' | 'yoloMode'>> = {
  orchestrator: {
    agentName: 'Orchestrator',
    capabilities: ['general', 'planning', 'orchestration'],
    tools: [],
    promptContent: [
      '# Orchestrator',
      'Coordinate the team. Break goals into small, verifiable tasks and delegate only through allowed routes.',
      'Prefer the least expensive capable agent, require acknowledgements and progress, and return one structured result.',
      'Do not edit code directly when a builder is available.',
    ].join('\n\n'),
  },
  planner: {
    agentName: 'Planner',
    capabilities: ['general', 'planning', 'analysis'],
    tools: [],
    promptContent: [
      '# Planner',
      'Turn the requested outcome into a concise implementation plan with acceptance criteria, risks, and test strategy.',
      'Return the plan as a structured result. Do not modify the repository.',
    ].join('\n\n'),
  },
  builder: {
    agentName: 'Builder',
    capabilities: ['general', 'coding'],
    tools: ['git', 'npm'],
    promptContent: [
      '# Builder',
      'Implement the assigned change in the provided workspace or worktree.',
      'Keep edits scoped, run focused checks, and return changed files plus verification as a structured result.',
    ].join('\n\n'),
  },
  tester: {
    agentName: 'Tester',
    capabilities: ['general', 'testing'],
    tools: ['npm'],
    promptContent: [
      '# Tester',
      'Verify assigned behavior with reproducible commands and focused tests.',
      'Do not claim success without command output. Return failures or passing evidence as a structured result.',
    ].join('\n\n'),
  },
  reviewer: {
    agentName: 'Reviewer',
    capabilities: ['general', 'review'],
    tools: ['git'],
    promptContent: [
      '# Reviewer',
      'Review changes for correctness, regressions, security risks, and missing tests.',
      'Lead with actionable findings. Return approval only when the evidence supports it.',
    ].join('\n\n'),
  },
  release: {
    agentName: 'Release',
    capabilities: ['general', 'release'],
    tools: ['git', 'npm'],
    promptContent: [
      '# Release',
      'Prepare a verified release summary and artifact checklist after implementation, tests, and review complete.',
      'Never publish, tag, merge, or deploy without explicit human approval.',
    ].join('\n\n'),
  },
};

const paneId = (index: number) => `Pane-${String.fromCharCode(65 + index)}`;

export const buildTopologyConnections = (
  topology: TopologyPresetId,
  panes: string[],
): Record<string, string[]> => {
  if (topology === 'solo') return { [panes[0]]: [] };
  if (topology === 'wheel') {
    const [hub, ...spokes] = panes;
    return {
      [hub]: spokes,
      ...Object.fromEntries(spokes.map((spoke) => [spoke, [hub]])),
    };
  }
  if (topology === 'pipeline') {
    return Object.fromEntries(panes.map((pane, index) => [pane, panes[index + 1] ? [panes[index + 1]] : []]));
  }
  const [hub, builder, tester, reviewer] = panes;
  return {
    [hub]: [builder],
    [builder]: [tester],
    [tester]: [reviewer],
    [reviewer]: [hub, builder],
  };
};

export const buildWorkspacePreset = (options: WorkspacePresetOptions): WorkspacePreset => {
  const roles = TOPOLOGY_PRESETS[options.topology].roles;
  const panes = roles.map((_, index) => paneId(index));
  const provider = PROVIDER_PRESETS[options.provider];
  const command = options.provider === 'custom' ? options.customCommand?.trim() || '' : provider.command;
  const model = options.model.trim() || provider.defaultModel;
  const agentConfigs = Object.fromEntries(roles.map((role, index) => {
    const pane = panes[index];
    const mixedCloudRole = options.provider === 'mixed' && (role === 'builder' || role === 'reviewer');
    const adapterId: AdapterId = mixedCloudRole
      ? 'gemini-cli'
      : options.provider === 'ollama' || options.provider === 'mixed'
        ? 'ollama-api'
        : options.provider === 'gemini'
          ? 'gemini-cli'
          : options.provider === 'copilot'
            ? 'copilot-cli'
            : 'custom';
    const cloudModel = mixedCloudRole || ['gemini', 'copilot'].includes(options.provider);
    const capabilityTier: 2 | 4 = cloudModel ? 4 : 2;

    return [pane, {
      ...ROLE_PRESETS[role],
      paneId: pane,
      adapterId,
      cliCommand: mixedCloudRole ? PROVIDER_PRESETS.gemini.command : command,
      selectedModel: mixedCloudRole ? PROVIDER_PRESETS.gemini.defaultModel : model,
      promptPath: '',
      capabilityTier,
      contextWindow: 32_000,
      inputCostPerMillionTokens: cloudModel ? 1 : 0,
      outputCostPerMillionTokens: cloudModel ? 4 : 0,
      expectedLatencyMs: cloudModel ? 3_000 : 1_000,
      yoloMode: false,
    }];
  }));
  return {
    paneIds: panes,
    activePaneId: panes[0],
    agentConfigs,
    connections: buildTopologyConnections(options.topology, panes),
  };
};
