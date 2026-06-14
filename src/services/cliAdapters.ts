export type AdapterId = 'ollama-api' | 'ollama-cli' | 'gemini-cli' | 'copilot-cli' | 'custom';
export type PromptDeliveryMode = 'stdin' | 'system-flag';
export type LifecycleMode = 'adapter' | 'model';
export type PrivacyMode = 'local' | 'cloud' | 'user-defined';

export interface AdapterAgentConfig {
  adapterId?: AdapterId;
  cliCommand: string;
  selectedModel: string;
  promptPath?: string;
  yoloMode?: boolean;
}

export interface CliAdapterDefinition {
  id: AdapterId;
  label: string;
  executable: string;
  promptDelivery: PromptDeliveryMode;
  lifecycle: LifecycleMode;
  privacy: PrivacyMode;
  toolSupport?: boolean;
  contextWindow?: number;
  modelFlag?: string;
  modelFlagAliases?: string[];
  systemPromptFlag?: string;
  unsafeFlag?: string;
  unsafeFlagAliases?: string[];
  bundled?: boolean;
  notes: string;
}

export interface AdapterLaunchPlan {
  adapter: CliAdapterDefinition;
  command: string;
  injectPrompt: boolean;
}

export const CLI_ADAPTERS: Record<AdapterId, CliAdapterDefinition> = {
  'ollama-api': {
    id: 'ollama-api',
    label: 'Bundled Ollama API Adapter',
    executable: 'ollama',
    promptDelivery: 'stdin',
    lifecycle: 'adapter',
    privacy: 'local',
    toolSupport: false,
    bundled: true,
    notes: 'Uses the local Ollama HTTP API and emits readiness and heartbeat messages itself.',
  },
  'ollama-cli': {
    id: 'ollama-cli',
    label: 'Ollama CLI',
    executable: 'ollama',
    promptDelivery: 'stdin',
    lifecycle: 'model',
    privacy: 'local',
    toolSupport: false,
    notes: 'Launches ollama run; the model must follow the injected Lightfold Grid contract.',
  },
  'gemini-cli': {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    executable: 'gemini',
    promptDelivery: 'stdin',
    lifecycle: 'model',
    privacy: 'cloud',
    toolSupport: true,
    modelFlag: '-m',
    modelFlagAliases: ['--model'],
    unsafeFlag: '--yolo',
    unsafeFlagAliases: ['-y'],
    notes: 'Supports model selection; Lightfold injects the generated contract through the interactive session.',
  },
  'copilot-cli': {
    id: 'copilot-cli',
    label: 'GitHub Copilot CLI',
    executable: 'copilot',
    promptDelivery: 'stdin',
    lifecycle: 'model',
    privacy: 'cloud',
    toolSupport: true,
    modelFlag: '--model',
    unsafeFlag: '--yolo',
    notes: 'Supports model selection; the model receives the contract through stdin.',
  },
  custom: {
    id: 'custom',
    label: 'Custom Interactive CLI',
    executable: '',
    promptDelivery: 'stdin',
    lifecycle: 'model',
    privacy: 'user-defined',
    notes: 'User-defined command. Compatibility depends on interactive PTY and prompt behavior.',
  },
};

const quote = (value: string) => `"${value.replaceAll('"', '\\"')}"`;
const hasFlag = (command: string, flag: string, aliases: string[] = []) => {
  const flags = [flag, ...aliases];
  return command.split(/\s+/).some((part) =>
    flags.some((candidate) => part === candidate || part.startsWith(`${candidate}=`)),
  );
};

export const inferAdapterId = (command = ''): AdapterId => {
  const normalized = command.toLowerCase();
  if (normalized.includes('lightfold-ollama-adapter')) return 'ollama-api';
  if (normalized.includes('ollama')) return 'ollama-cli';
  if (normalized.includes('gemini')) return 'gemini-cli';
  if (normalized.includes('copilot')) return 'copilot-cli';
  return 'custom';
};

export const resolveAdapter = (config: AdapterAgentConfig): CliAdapterDefinition =>
  CLI_ADAPTERS[config.adapterId || inferAdapterId(config.cliCommand)];

export const buildAdapterLaunchPlan = (
  config: AdapterAgentConfig,
  bundledAdapterCommand = '',
): AdapterLaunchPlan => {
  const adapter = resolveAdapter(config);
  let command = adapter.bundled ? bundledAdapterCommand : config.cliCommand.trim();
  if (!command) return { adapter, command: '', injectPrompt: true };

  const model = config.selectedModel?.trim();
  if (adapter.id === 'ollama-api' && model && model.toLowerCase() !== 'auto') {
    command += ` --model ${quote(model)}`;
  } else if (adapter.id === 'ollama-cli' && model && model.toLowerCase() !== 'auto' && !command.includes(model)) {
    command += ` ${quote(model)}`;
  } else if (
    adapter.modelFlag &&
    model &&
    model.toLowerCase() !== 'auto' &&
    !hasFlag(command, adapter.modelFlag, adapter.modelFlagAliases)
  ) {
    command += ` ${adapter.modelFlag} ${quote(model)}`;
  }

  let injectPrompt = true;
  if (
    adapter.systemPromptFlag &&
    config.promptPath &&
    !hasFlag(command, adapter.systemPromptFlag) &&
    !command.includes('--system')
  ) {
    command += ` ${adapter.systemPromptFlag} ${quote(config.promptPath)}`;
    injectPrompt = false;
  }

  if (
    config.yoloMode &&
    adapter.unsafeFlag &&
    !hasFlag(command, adapter.unsafeFlag, adapter.unsafeFlagAliases)
  ) {
    command += ` ${adapter.unsafeFlag}`;
  }
  return { adapter, command, injectPrompt };
};

export const discoverAdapterCapabilities = (config: AdapterAgentConfig) => {
  const adapter = resolveAdapter(config);
  return {
    adapterId: adapter.id,
    privacy: adapter.privacy,
    lifecycle: adapter.lifecycle,
    promptDelivery: adapter.promptDelivery,
    model: config.selectedModel || 'auto',
    toolSupport: adapter.toolSupport,
    contextWindow: adapter.contextWindow,
  };
};
