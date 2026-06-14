import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { commandExecutable, commandExists } from './platform.js';

export type HealthStatus = 'pass' | 'warn' | 'fail';

export interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
}

export interface HealthAgentConfig {
  paneId?: string;
  agentName?: string;
  cliCommand?: string;
  selectedModel?: string;
  promptPath?: string;
}

export interface HealthCheckInput {
  workspaceRoot?: string;
  agentConfigs?: Record<string, HealthAgentConfig>;
}

const SECRET_KEY = /(token|secret|password|passwd|authorization|api[-_]?key|access[-_]?key|private[-_]?key|credential|cookie)/i;
const SECRET_VALUE = new RegExp([
  'bearer\\s+[a-z0-9._~+/-]+=*',
  'sk-[a-z0-9_-]+',
  'gh[pousr]_[a-z0-9_]+',
  'github_pat_[a-z0-9_]+',
  'glpat-[a-z0-9_-]+',
  'npm_[a-z0-9]+',
  'xox[baprs]-[a-z0-9-]+',
  'AKIA[A-Z0-9]{16}',
  'AIza[a-z0-9_-]{20,}',
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
  'https?://[^\\s/:]+:[^\\s/@]+@',
  '(password|passwd|token|secret|api[-_]?key|access[-_]?key|private[-_]?key|authorization)\\s*[:=]\\s*\\S+',
].join('|'), 'i');

export const redactDiagnostics = (value: unknown, key = ''): unknown => {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return SECRET_VALUE.test(value) ? '[REDACTED]' : value;
  if (Array.isArray(value)) return value.map((item) => redactDiagnostics(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => (
      [entryKey, redactDiagnostics(entryValue, entryKey)]
    )));
  }
  return value;
};

export const runWorkspaceHealthChecks = (input: HealthCheckInput): HealthCheck[] => {
  const checks: HealthCheck[] = [];
  const root = input.workspaceRoot?.trim();
  if (!root) {
    checks.push({ id: 'git', label: 'Git workspace', status: 'warn', detail: 'No workspace selected.' });
  } else {
    try {
      const result = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      checks.push({ id: 'git', label: 'Git workspace', status: result === 'true' ? 'pass' : 'fail', detail: root });
    } catch {
      checks.push({ id: 'git', label: 'Git workspace', status: 'fail', detail: `${root} is not a Git repository.` });
    }
  }

  const configs = Object.values(input.agentConfigs || {});
  if (configs.length === 0) {
    checks.push({ id: 'agents', label: 'Agent configuration', status: 'warn', detail: 'No agents configured.' });
  }
  for (const config of configs) {
    const id = config.paneId || config.agentName || 'agent';
    const cliReady = commandExists(config.cliCommand || '');
    checks.push({
      id: `cli:${id}`,
      label: `${id} CLI`,
      status: cliReady ? 'pass' : 'fail',
      detail: cliReady ? commandExecutable(config.cliCommand) : `Executable not found: ${commandExecutable(config.cliCommand) || '(empty)'}`,
    });
    checks.push({
      id: `prompt:${id}`,
      label: `${id} prompt`,
      status: !config.promptPath ? 'warn' : existsSync(config.promptPath) ? 'pass' : 'fail',
      detail: config.promptPath || 'No prompt file configured.',
    });
  }

  const ollamaConfigs = configs.filter((config) => commandExecutable(config.cliCommand).endsWith('ollama'));
  if (ollamaConfigs.length > 0) {
    try {
      const output = execFileSync('ollama', ['list'], { encoding: 'utf8', timeout: 3_000 });
      checks.push({ id: 'ollama', label: 'Ollama', status: 'pass', detail: 'Ollama is reachable.' });
      for (const config of ollamaConfigs) {
        if (!config.selectedModel || config.selectedModel === 'auto') continue;
        checks.push({
          id: `model:${config.paneId || config.selectedModel}`,
          label: `${config.paneId || 'Ollama'} model`,
          status: output.includes(config.selectedModel) ? 'pass' : 'fail',
          detail: config.selectedModel,
        });
      }
    } catch {
      checks.push({ id: 'ollama', label: 'Ollama', status: 'fail', detail: 'Ollama is unavailable.' });
    }
  }
  return checks;
};

export const createDiagnosticBundle = (input: {
  generatedAt?: string;
  snapshot: unknown;
  health: HealthCheck[];
  workspace?: unknown;
}) => redactDiagnostics({
  formatVersion: 1,
  generatedAt: input.generatedAt || new Date().toISOString(),
  snapshot: input.snapshot,
  health: input.health,
  workspace: input.workspace,
});
