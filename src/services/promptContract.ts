export const AGENT_PROMPT_VERSION = 1;
export const DEFAULT_AGENT_CAPABILITIES = ['general'];

export interface AgentPromptContractInput {
  paneId: string;
  role: string;
  allowedRoutes: string[];
  capabilities: string[];
  tools: string[];
  roleInstructions?: string;
  helperCommand?: string;
}

const list = (values: string[]) => values.length > 0 ? values.join(', ') : '(none)';

export const normalizeCapabilities = (capabilities: string[] | undefined): string[] => {
  const normalized = (capabilities || [])
    .map((capability) => capability.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(normalized)].sort();
};

export const generateAgentPromptContract = (input: AgentPromptContractInput): string => {
  const helper = input.helperCommand || 'lightfold-message';
  const capabilities = normalizeCapabilities(input.capabilities);
  const sections = [
    '# Lightfold Grid Agent Contract',
    `Prompt version: ${AGENT_PROMPT_VERSION}`,
    `Agent ID: ${input.paneId}`,
    `Role: ${input.role || 'General agent'}`,
    `Allowed message targets: ${list(input.allowedRoutes)}`,
    `Capabilities: ${list(capabilities)}`,
    `Tools: ${list(normalizeCapabilities(input.tools))}`,
    '',
    '## Required Behavior',
    '- Treat the physical Agent ID above as your identity. Never claim another sender identity.',
    '- Only send messages to an allowed message target.',
    '- On startup, announce readiness with the helper command below.',
    '- For every assigned task, acknowledge before doing work.',
    '- Report progress during long-running work.',
    '- Finish with exactly one structured result, error, or cancel message.',
    '- Repeated deliveries with the same message ID are retries; do not execute them twice.',
    '',
    '## Message Helper',
    `Use \`${helper}\` to emit protocol messages. Do not hand-write envelope markers or JSON.`,
    `Ready: \`${helper} ready --to broker --summary ready\``,
    `Heartbeat: \`${helper} heartbeat --to broker --summary alive\``,
    `Acknowledge: \`${helper} ack --to <sender> --task-id <task-id> --correlation-id <message-id> --summary accepted\``,
    `Progress: \`${helper} progress --to <sender> --task-id <task-id> --correlation-id <message-id> --summary "status"\``,
    `Result: \`${helper} result --to <sender> --task-id <task-id> --correlation-id <message-id> --summary "outcome" --artifact <path>\``,
    `Error: \`${helper} error --to <sender> --task-id <task-id> --correlation-id <message-id> --summary "failure"\``,
  ];
  if (input.roleInstructions?.trim()) {
    sections.push('', `## Role Instructions\n${input.roleInstructions.trim()}`);
  }
  return sections.join('\n');
};

export const hasCapabilities = (available: string[] | undefined, required: string[] | undefined): boolean => {
  const availableSet = new Set(normalizeCapabilities(available));
  return normalizeCapabilities(required).every((capability) => availableSet.has(capability));
};

export const findCapabilityMismatch = <
  Task extends { owner: string; requiredCapabilities?: string[]; requiredTools?: string[] },
  Agent extends { agentId: string; capabilities?: string[]; tools?: string[] }
>(
  tasks: Task[],
  agents: Agent[]
): Task | undefined => {
  const byId = new Map(agents.map((agent) => [agent.agentId, agent]));
  return tasks.find((task) => {
    const agent = byId.get(task.owner);
    return agent && (
      !hasCapabilities(agent.capabilities, task.requiredCapabilities) ||
      !hasCapabilities(agent.tools, task.requiredTools)
    );
  });
};
