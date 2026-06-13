import { subscribeToStream } from './terminalRegistry';
import {
  AgentMessage,
  AgentLifecycleManager,
  AgentLifecycleRecord,
  BoundedMessageHistory,
  createProtocolId,
  DEFAULT_MESSAGE_HISTORY_LIMIT,
  getMessageInstruction,
  isRouteAllowed,
  normalizeAgentMessage,
  ProtocolValidationError,
  PtyDeliveryQueue,
  ReliableRequestManager,
  ReliableRequestStatus,
  ReliabilityOptions,
  StarlightEnvelopeParser,
} from './brokerCore';
import {
  WorkflowDefinition,
  WorkflowEngine,
  WorkflowRecord,
  WorkflowTaskRecord,
  WorkflowValidationError,
} from './workflowCore';
import {
  AGENT_PROMPT_VERSION,
  findCapabilityMismatch,
  hasCapabilities,
  normalizeCapabilities,
} from './promptContract';
import type { BrokerEvent, BrokerObservabilitySnapshot } from './observability';

export type BrokerMessageStatus = 'pending' | ReliableRequestStatus;

export interface StarlightMessage extends AgentMessage {
  id: string;
  command: string;
  type: string;
  status: BrokerMessageStatus;
  error?: string;
  deliveredAt?: number;
  acknowledgedAt?: number;
  completedAt?: number;
}

const messageListeners = new Set<(msg: StarlightMessage) => void>();
const queueListeners = new Set<(paneId: string, queue: string[]) => void>();
const lifecycleListeners = new Set<(record: AgentLifecycleRecord) => void>();
const workflowListeners = new Set<(workflow: WorkflowRecord) => void>();
const observabilityListeners = new Set<(snapshot: BrokerObservabilitySnapshot) => void>();
let brokerStateInitialized = false;
let brokerStateHydrating = false;
let brokerRetentionLimit = 5_000;
let brokerWorkspaceRoot = '';
const preparingWorkflowTasks = new Set<string>();
let durableEvents: BrokerEvent[] = [];

const persist = (operation: Promise<unknown> | undefined) => {
  operation?.catch((error) => console.error('Failed to persist broker state:', error));
};

// Bounded renderer projection of the authoritative durable broker history.
const messagesLog = new BoundedMessageHistory<StarlightMessage>(DEFAULT_MESSAGE_HISTORY_LIMIT);

// Configuration variables (can be modified in Settings)
let commandBlocklist: string[] = ['rm -rf /', 'sudo rm', 'mkfs'];
let trustedCommands: string[] = ['git status', 'ls -la', 'pwd', 'npm run build'];
let isAutopilot = false;
let routingConnections: Record<string, string[]> = {};

export const getMessagesLog = () => messagesLog.values();
export const getBrokerObservabilitySnapshot = (): BrokerObservabilitySnapshot => ({
  agents: agentLifecycle.values(),
  messages: messagesLog.values(),
  workflows: workflowEngine.values(),
  events: [...durableEvents],
});
export const subscribeToBrokerObservability = (listener: (snapshot: BrokerObservabilitySnapshot) => void) => {
  observabilityListeners.add(listener);
  return () => {
    observabilityListeners.delete(listener);
  };
};
const notifyObservabilityListeners = () => {
  if (brokerStateHydrating) return;
  const snapshot = getBrokerObservabilitySnapshot();
  observabilityListeners.forEach((listener) => listener(snapshot));
};
export const getBrokerRetentionLimit = () => brokerRetentionLimit;
export const setBrokerRetentionLimit = (limit: number) => {
  if (!Number.isInteger(limit) || limit < 100) throw new Error('Broker retention limit must be at least 100.');
  brokerRetentionLimit = limit;
  persist((window as any).electronAPI?.setBrokerSetting('retentionLimit', limit));
};
export const setAutopilot = (val: boolean) => { isAutopilot = val; };
export const getAutopilot = () => isAutopilot;
export const getBlocklist = () => commandBlocklist;
export const setBlocklist = (list: string[]) => { commandBlocklist = list; };
export const getTrustedCommands = () => trustedCommands;
export const setTrustedCommands = (list: string[]) => { trustedCommands = list; };
export const getRoutingConnections = () => routingConnections;
export const setRoutingConnections = (conns: Record<string, string[]>) => {
  routingConnections = conns;
};
export const setBrokerWorkspaceRoot = (workspaceRoot: string) => {
  brokerWorkspaceRoot = workspaceRoot;
};

export const subscribeToMessages = (callback: (msg: StarlightMessage) => void) => {
  messageListeners.add(callback);
  return () => {
    messageListeners.delete(callback);
  };
};

export const subscribeToQueues = (callback: (paneId: string, queue: string[]) => void) => {
  queueListeners.add(callback);
  return () => {
    queueListeners.delete(callback);
  };
};

const notifyMessageListeners = (msg: StarlightMessage) => {
  messageListeners.forEach((l) => l(msg));
  notifyObservabilityListeners();
};

const appendMessage = (msg: StarlightMessage) => {
  messagesLog.append(msg);
  notifyMessageListeners(msg);
  persist((window as any).electronAPI?.persistBrokerMessage(msg));
};

const updateMessage = (
  messageId: string,
  patch: Partial<Omit<StarlightMessage, 'id' | 'messageId'>>
) => {
  const updated = messagesLog.update(messageId, (msg) => ({ ...msg, ...patch }));
  if (updated) {
    notifyMessageListeners(updated);
    persist((window as any).electronAPI?.persistBrokerMessage(updated));
  }
  return updated;
};

const recordProtocolError = (sourceId: string, error: unknown) => {
  const description = error instanceof Error ? error.message : String(error);
  const messageId = createProtocolId();
  const protocolError: StarlightMessage = {
    protocolVersion: 1,
    messageId,
    id: messageId,
    taskId: createProtocolId(),
    from: 'broker',
    to: sourceId,
    kind: 'error',
    payload: {
      summary: description,
      data: {
        code: error instanceof ProtocolValidationError ? error.code : 'PARSE_ERROR',
      },
    },
    attempt: 1,
    timestamp: Date.now(),
    command: description,
    type: 'error',
    status: 'failed',
    error: description,
  };
  appendMessage(protocolError);
};

const notifyQueueListeners = (paneId: string) => {
  const q = deliveryQueue.getQueue(paneId);
  queueListeners.forEach((l) => l(paneId, q.map((entry) => entry.command)));
};

const parser = new StarlightEnvelopeParser();
const agentLifecycle = new AgentLifecycleManager((record) => {
  lifecycleListeners.forEach((listener) => listener(record));
  persist((window as any).electronAPI?.persistBrokerAgent(record));
  notifyObservabilityListeners();
});
const deliveryQueue = new PtyDeliveryQueue(
  (paneId, data) => (window as any).electronAPI.writePty(paneId, data),
  (paneId) => notifyQueueListeners(paneId),
  (entry, status, error) => {
    if (!entry.messageId) return;
    updateMessage(entry.messageId, { status, error });
  }
);
const reliableRequests = new ReliableRequestManager(
  (paneId, data) => (window as any).electronAPI.writePty(paneId, data),
  (record) => {
    updateMessage(record.message.messageId, {
      to: record.message.to,
      attempt: record.attempt,
      status: record.status,
      error: record.error,
      deliveredAt: record.deliveredAt,
      acknowledgedAt: record.acknowledgedAt,
      completedAt: record.completedAt,
    });
    if (record.status === 'queued') {
      agentLifecycle.taskFinished(record.message.to, record.message.taskId);
      reliableRequests.wakeTarget(record.message.to);
    } else if (['completed', 'cancelled'].includes(record.status)) {
      agentLifecycle.taskFinished(record.message.to, record.message.taskId);
      reliableRequests.wakeTarget(record.message.to);
    } else if (record.status === 'failed') {
      const lifecycle = agentLifecycle.get(record.message.to);
      if (lifecycle?.currentTaskId === record.message.taskId) {
        agentLifecycle.unresponsive(record.message.to, record.error || 'Task delivery failed.');
      }
    }
    const workflowTask = findWorkflowTaskByMessageId(record.message.messageId);
    if (workflowTask) {
      if (record.status === 'acknowledged') {
        workflowEngine.taskRunning(workflowTask.workflowId, workflowTask.id);
      } else if (record.status === 'failed') {
        workflowEngine.failTask(workflowTask.workflowId, workflowTask.id, record.error || 'Task delivery failed.');
      } else if (record.status === 'cancelled') {
        workflowEngine.failTask(workflowTask.workflowId, workflowTask.id, record.error || 'Task cancelled.');
      }
    }
  },
  undefined,
  {},
  Date.now,
  {
    canDeliver: (targetId, taskId) => agentLifecycle.canAcceptTask(targetId, taskId),
    onTaskStarted: (targetId, taskId) => agentLifecycle.taskStarted(targetId, taskId),
  }
);

const notifyWorkflowListeners = (workflow: WorkflowRecord) => {
  workflowListeners.forEach((listener) => listener(workflow));
  persist((window as any).electronAPI?.persistBrokerWorkflow(workflow));
  notifyObservabilityListeners();
  if (workflow.status === 'cancelled') {
    workflow.tasks.forEach((task) => {
      if (task.messageId) reliableRequests.cancel(task.messageId, 'Workflow cancelled.');
    });
  }
};

const workflowEngine = new WorkflowEngine({
  onWorkflowUpdate: notifyWorkflowListeners,
  onTaskUpdate: (task) => {
    const workflow = workflowEngine.get(task.workflowId);
    if (workflow) notifyWorkflowListeners(workflow);
  },
  onDispatch: (task) => void dispatchWorkflowTask(task),
});

const findWorkflowTaskByMessageId = (messageId: string): WorkflowTaskRecord | undefined => {
  return workflowEngine.values()
    .flatMap((workflow) => workflow.tasks)
    .find((task) => task.messageId === messageId);
};

const worktreeSummary = (record: any) => ({
  worktreePath: record.worktreePath,
  branch: record.branch,
  baseCommit: record.baseCommit,
  changedFiles: record.changedFiles || [],
  status: record.status,
  testOutput: record.testOutput,
  error: record.error,
});

const dispatchWorkflowTask = async (task: WorkflowTaskRecord) => {
  const taskKey = `${task.workflowId}:${task.id}`;
  if (preparingWorkflowTasks.has(taskKey)) return;
  preparingWorkflowTasks.add(taskKey);
  const owner = agentLifecycle.get(task.owner);
  if (
    !owner ||
    !hasCapabilities(owner.capabilities, task.requiredCapabilities) ||
    !hasCapabilities(owner.tools, task.requiredTools)
  ) {
    workflowEngine.failTask(
      task.workflowId,
      task.id,
      `Agent ${task.owner} lacks required capabilities or tools.`
    );
    preparingWorkflowTasks.delete(taskKey);
    return;
  }
  workflowEngine.setTaskPromptVersion(task.workflowId, task.id, owner.promptVersion || AGENT_PROMPT_VERSION);
  let instruction = task.goal;
  let worktree: any;
  try {
    if (task.coding) {
      if (!brokerWorkspaceRoot) throw new Error('Coding workflows require a selected Git repository workspace.');
      const result = await (window as any).electronAPI.prepareWorktree({
        workspaceRoot: brokerWorkspaceRoot,
        workflowId: task.workflowId,
        taskId: task.id,
        owner: task.owner,
        config: task.coding,
      });
      if (!result?.success) throw new Error(result?.error || 'Failed to prepare coding worktree.');
      worktree = result.record;
      workflowEngine.updateWorktree(task.workflowId, task.id, worktreeSummary(worktree));
      instruction = [
        task.goal,
        '',
        `Work exclusively in this Git worktree: ${worktree.worktreePath}`,
        `Task branch: ${worktree.branch}`,
        `Base commit: ${worktree.baseCommit}`,
        'Do not edit the original workspace. Commit your completed changes to the task branch.',
      ].join('\n');
    }
  } catch (error) {
    workflowEngine.failTask(task.workflowId, task.id, error instanceof Error ? error.message : String(error));
    preparingWorkflowTasks.delete(taskKey);
    return;
  }
  const messageId = createProtocolId();
  const message: StarlightMessage = {
    protocolVersion: 1,
    messageId,
    id: messageId,
    taskId: `workflow:${task.workflowId}:${task.id}`,
    from: 'broker',
    to: task.owner,
    kind: 'request',
    payload: {
      instruction,
      data: {
        workflowId: task.workflowId,
        workflowTaskId: task.id,
        completionCriteria: task.completionCriteria,
        requiredCapabilities: task.requiredCapabilities,
        requiredTools: task.requiredTools,
        promptVersion: owner.promptVersion || AGENT_PROMPT_VERSION,
        coding: task.coding,
        worktree,
      },
    },
    attempt: 1,
    timestamp: Date.now(),
    command: instruction,
    type: 'request',
    status: 'queued',
  };
  workflowEngine.assignTask(task.workflowId, task.id, messageId);
  appendMessage(message);
  reliableRequests.submit(message);
  preparingWorkflowTasks.delete(taskKey);
};

export const getDeadLetters = () => reliableRequests.getDeadLetters();
export const getReliabilitySettings = () => reliableRequests.getOptions();
export const setReliabilitySettings = (settings: ReliabilityOptions) => reliableRequests.configure(settings);
export const getAgentLifecycles = () => agentLifecycle.values();
export const getWorkflows = () => workflowEngine.values();
export const subscribeToWorkflows = (listener: (workflow: WorkflowRecord) => void) => {
  workflowListeners.add(listener);
  return () => {
    workflowListeners.delete(listener);
  };
};
export const createWorkflow = (definition: WorkflowDefinition) => {
  const agents = agentLifecycle.values();
  const knownAgents = new Map(agents.map((agent) => [agent.agentId, agent]));
  const unknownOwner = knownAgents.size > 0
    ? definition.tasks.find((task) => !knownAgents.has(task.owner))
    : undefined;
  if (unknownOwner) throw new WorkflowValidationError(`Workflow task ${unknownOwner.id} targets unknown agent ${unknownOwner.owner}.`);
  const incapableOwner = findCapabilityMismatch(definition.tasks, agents);
  if (incapableOwner) {
    throw new WorkflowValidationError(
      `Workflow task ${incapableOwner.id} requires capabilities or tools unavailable on ${incapableOwner.owner}. ` +
      `Capabilities: ${normalizeCapabilities(incapableOwner.requiredCapabilities).join(', ') || '(none)'}. ` +
      `Tools: ${normalizeCapabilities(incapableOwner.requiredTools).join(', ') || '(none)'}.`
    );
  }
  if (definition.tasks.some((task) => task.coding) && !brokerWorkspaceRoot) {
    throw new WorkflowValidationError('Coding workflows require a selected Git repository workspace.');
  }
  return workflowEngine.create(definition);
};
export const approveWorkflowTask = (workflowId: string, taskId: string) => workflowEngine.approveTask(workflowId, taskId);
export const retryWorkflowTask = (workflowId: string, taskId: string) => workflowEngine.retryTask(workflowId, taskId);
export const reassignWorkflowTask = (workflowId: string, taskId: string, owner: string) => {
  const agent = agentLifecycle.get(owner);
  const task = workflowEngine.get(workflowId)?.tasks.find((candidate) => candidate.id === taskId);
  if (
    !agent ||
    !task ||
    !hasCapabilities(agent.capabilities, task.requiredCapabilities) ||
    !hasCapabilities(agent.tools, task.requiredTools)
  ) return false;
  return workflowEngine.reassignTask(workflowId, taskId, owner);
};
export const cancelWorkflow = (workflowId: string) => {
  const workflow = workflowEngine.get(workflowId);
  const cancelled = workflowEngine.cancel(workflowId);
  workflow?.tasks.forEach((task) => {
    if (task.messageId) reliableRequests.cancel(task.messageId, 'Workflow cancelled by operator.');
  });
  return cancelled;
};
export const approveAndMergeWorkflowTask = async (workflowId: string, taskId: string) => {
  const electronAPI = (window as any).electronAPI;
  const tested = await electronAPI.runWorktreeTests(workflowId, taskId);
  if (!tested?.success) throw new Error(tested?.error || 'Failed to run worktree tests.');
  workflowEngine.updateWorktree(workflowId, taskId, worktreeSummary(tested.record));
  if (tested.record.status !== 'review') return false;
  const approved = await electronAPI.approveWorktreeReview(workflowId, taskId);
  if (!approved?.success) throw new Error(approved?.error || 'Failed to approve worktree.');
  const merged = await electronAPI.mergeWorktree(workflowId, taskId);
  if (!merged?.success) throw new Error(merged?.error || 'Failed to merge worktree.');
  workflowEngine.updateWorktree(workflowId, taskId, worktreeSummary(merged.record));
  if (merged.record.status !== 'merged') return false;
  return workflowEngine.completeReview(workflowId, taskId);
};
export const approveWorkflowSharedFiles = async (workflowId: string, taskId: string) => {
  const result = await (window as any).electronAPI.approveWorktreeSharedFiles(workflowId, taskId);
  if (!result?.success) throw new Error(result?.error || 'Failed to approve shared files.');
  workflowEngine.updateWorktree(workflowId, taskId, worktreeSummary(result.record));
  return result.record;
};
export const testWorkflowWorktree = async (workflowId: string, taskId: string) => {
  const result = await (window as any).electronAPI.runWorktreeTests(workflowId, taskId);
  if (!result?.success) throw new Error(result?.error || 'Failed to run worktree tests.');
  workflowEngine.updateWorktree(workflowId, taskId, worktreeSummary(result.record));
  return result.record;
};
export const cleanupWorkflowWorktree = async (workflowId: string, taskId: string, force = false) => {
  const result = await (window as any).electronAPI.cleanupWorktree(workflowId, taskId, force);
  if (!result?.success) throw new Error(result?.error || 'Failed to clean up worktree.');
  workflowEngine.updateWorktree(workflowId, taskId, worktreeSummary(result.record));
  return result.record;
};
export const subscribeToAgentLifecycle = (listener: (record: AgentLifecycleRecord) => void) => {
  lifecycleListeners.add(listener);
  return () => {
    lifecycleListeners.delete(listener);
  };
};
export const registerAgent = (
  agentId: string,
  contract: { role?: string; capabilities?: string[]; tools?: string[]; promptVersion?: number } = {}
) => agentLifecycle.register(agentId, {
  ...contract,
  capabilities: normalizeCapabilities(contract.capabilities),
  tools: normalizeCapabilities(contract.tools),
  promptVersion: contract.promptVersion || AGENT_PROMPT_VERSION,
});
export const markAgentStarting = (agentId: string) => agentLifecycle.starting(agentId);
export const markAgentReady = (agentId: string) => {
  const record = agentLifecycle.ready(agentId);
  reliableRequests.wakeTarget(agentId);
  return record;
};
export const heartbeatAgent = (agentId: string) => agentLifecycle.heartbeat(agentId);
export const markAgentStopping = (agentId: string) => agentLifecycle.stopping(agentId);
export const markAgentStopped = (agentId: string) => agentLifecycle.stopped(agentId);
export const markAgentFailed = (agentId: string, error: string) => {
  reliableRequests.failTarget(agentId, error);
  return agentLifecycle.failed(agentId, error);
};
export const checkAgentHealth = () => {
  const unresponsive = agentLifecycle.checkHealth();
  unresponsive.forEach((record) => reliableRequests.failTarget(record.agentId, record.error || 'Heartbeat timeout.'));
  return unresponsive;
};

export const initializeBrokerState = async () => {
  const electronAPI = (window as any).electronAPI;
  if (!electronAPI || brokerStateInitialized) return;
  brokerStateInitialized = true;

  const hydrate = async () => {
    const snapshot = await electronAPI.getBrokerSnapshot();
    if (!snapshot) return;
    brokerStateHydrating = true;
    const messages = (snapshot.messages || []) as StarlightMessage[];
    try {
      durableEvents = (snapshot.events || []) as BrokerEvent[];
      messagesLog.replaceAll(messages);
      (snapshot.agents || []).forEach((record: AgentLifecycleRecord) => agentLifecycle.restore(record));
      (snapshot.workflows || []).forEach((workflow: WorkflowRecord) => {
        if (!workflowEngine.get(workflow.id)) workflowEngine.restore(workflow);
      });
      const retention = snapshot.settings?.retentionLimit;
      if (Number.isInteger(retention) && retention >= 100) brokerRetentionLimit = retention;
      messages.forEach((message) => notifyMessageListeners(message));
      (snapshot.agents || []).forEach((record: AgentLifecycleRecord) => {
        lifecycleListeners.forEach((listener) => listener(record));
      });
      workflowEngine.values().forEach((workflow) => workflowListeners.forEach((listener) => listener(workflow)));
    } finally {
      brokerStateHydrating = false;
    }
    notifyObservabilityListeners();
    messages
      .filter((message) => message.kind === 'request' && message.status === 'queued')
      .forEach((message) => reliableRequests.restore(message));
  };

  await hydrate();
  electronAPI.onBrokerChanged(() => {
    void hydrate();
  });
};

// Start listening to the raw terminal output stream
subscribeToStream((id, chunk) => {
  const result = parser.push(id, chunk);

  result.errors.forEach(({ error, payload }) => {
    console.error('Failed to parse intercepted broker JSON:', error, payload);
    recordProtocolError(id, error);
  });

  for (const { sourceId, envelope } of result.messages) {
    try {
      const normalized = normalizeAgentMessage(envelope, { sourceId });
      const newMsg: StarlightMessage = {
        ...normalized,
        id: normalized.messageId,
        command: getMessageInstruction(normalized),
        type: normalized.kind,
        status: 'pending',
      };

      appendMessage(newMsg);
      processMessage(newMsg);
    } catch (error) {
      console.error('Rejected invalid broker message:', error, envelope);
      recordProtocolError(sourceId, error);
    }
  }
});

const processMessage = (msg: StarlightMessage) => {
  const targetPane = msg.to;
  const sourcePane = msg.from;

  if (msg.kind === 'ready') {
    if (targetPane !== 'broker') {
      updateMessage(msg.messageId, { status: 'failed', error: 'Lifecycle messages must target broker.' });
      return;
    }
    markAgentReady(sourcePane);
    updateMessage(msg.messageId, { status: 'completed' });
    return;
  }
  if (msg.kind === 'heartbeat') {
    if (targetPane !== 'broker') {
      updateMessage(msg.messageId, { status: 'failed', error: 'Lifecycle messages must target broker.' });
      return;
    }
    heartbeatAgent(sourcePane);
    updateMessage(msg.messageId, { status: 'completed' });
    return;
  }

  if (msg.kind === 'request' && targetPane === 'broker') {
    const data = msg.payload.data as { workflowDefinition?: WorkflowDefinition } | undefined;
    if (!data?.workflowDefinition) {
      updateMessage(msg.messageId, { status: 'failed', error: 'Broker requests must contain workflowDefinition.' });
      return;
    }
    try {
      createWorkflow({ ...data.workflowDefinition, createdBy: sourcePane });
      updateMessage(msg.messageId, { status: 'completed' });
    } catch (error) {
      const description = error instanceof WorkflowValidationError || error instanceof Error
        ? error.message
        : String(error);
      updateMessage(msg.messageId, { status: 'failed', error: description });
    }
    return;
  }

  const isConnected = isRouteAllowed(routingConnections, sourcePane, targetPane);
  
  if (!isConnected) {
    updateMessage(msg.messageId, {
      status: 'failed',
      error: `Routing Blocked: No connection path configured from ${sourcePane} to ${targetPane}.`,
    });
    return;
  }

  if (msg.kind !== 'request') {
    const disposition = reliableRequests.handleResponse(msg);
    const workflowTask = msg.correlationId ? findWorkflowTaskByMessageId(msg.correlationId) : undefined;
    if (workflowTask && disposition === 'accepted') {
      if (msg.kind === 'result') {
        const result = {
          summary: msg.payload.summary,
          artifacts: msg.payload.artifacts,
        };
        if (workflowTask.coding) {
          if (workflowEngine.submitForReview(workflowTask.workflowId, workflowTask.id, result)) {
            void (async () => {
              const inspected = await (window as any).electronAPI.inspectWorktree(workflowTask.workflowId, workflowTask.id);
              if (!inspected?.success) {
                workflowEngine.failTask(workflowTask.workflowId, workflowTask.id, inspected?.error || 'Failed to inspect coding worktree.');
                return;
              }
              workflowEngine.updateWorktree(workflowTask.workflowId, workflowTask.id, worktreeSummary(inspected.record));
              if (inspected.record.status === 'conflicted') return;
              const tested = await (window as any).electronAPI.runWorktreeTests(workflowTask.workflowId, workflowTask.id);
              if (!tested?.success) {
                workflowEngine.failTask(workflowTask.workflowId, workflowTask.id, tested?.error || 'Failed to test coding worktree.');
                return;
              }
              workflowEngine.updateWorktree(workflowTask.workflowId, workflowTask.id, worktreeSummary(tested.record));
            })();
          }
        } else {
          workflowEngine.submitResult(workflowTask.workflowId, workflowTask.id, result);
        }
      } else if (msg.kind === 'error' || msg.kind === 'cancel') {
        workflowEngine.failTask(
          workflowTask.workflowId,
          workflowTask.id,
          getMessageInstruction(msg) || `Agent reported ${msg.kind}.`
        );
      }
    }
    if (msg.kind === 'ack') {
      updateMessage(msg.messageId, {
        status: disposition === 'unmatched' ? 'failed' : 'completed',
        error: disposition === 'unmatched' ? 'No matching request for acknowledgement.' : undefined,
      });
      return;
    }
    if (disposition === 'duplicate') {
      updateMessage(msg.messageId, { status: 'completed', error: 'Duplicate response ignored.' });
      return;
    }
  }
  
  // Check Blocklists
  const isBlocked = commandBlocklist.some(cmd => msg.command.toLowerCase().includes(cmd.toLowerCase()));
  if (isBlocked) {
    updateMessage(msg.messageId, { status: 'failed', error: 'Blocked command filter matched.' });
    return;
  }
  
  // Check Trusted Command or Autopilot
  const isTrusted = trustedCommands.some(cmd => cmd.toLowerCase() === msg.command.trim().toLowerCase());
  
  if (isAutopilot || isTrusted) {
    approveMessage(msg.messageId, msg.command);
  } else {
    // Falls to Gatekeeper modal approval
    // (UI component listens to messagesLog with 'pending' status)
  }
};

// Queue commands for a terminal pane
export const enqueueCommand = (paneId: string, command: string, msgId?: string) => {
  if (!msgId) {
    deliveryQueue.enqueue(paneId, { command });
    return;
  }
  approveMessage(msgId, command);
};

export const rejectMessage = (msgId: string) => {
  const msg = getMessagesLog().find((message) => message.messageId === msgId);
  if (msg?.kind === 'request') {
    if (!reliableRequests.cancel(msgId, 'Rejected by operator.')) {
      updateMessage(msgId, { status: 'cancelled', error: 'Rejected by operator.' });
    }
  } else {
    updateMessage(msgId, { status: 'cancelled', error: 'Rejected by operator.' });
  }
};

export const retryMessage = (msgId: string) => reliableRequests.retry(msgId);

export const cancelMessage = (msgId: string) => reliableRequests.cancel(msgId);

export const reassignMessage = (msgId: string, targetId: string) => {
  const msg = getMessagesLog().find((message) => message.messageId === msgId);
  if (!msg || !isRouteAllowed(routingConnections, msg.from, targetId)) return false;
  return reliableRequests.reassign(msgId, targetId);
};

const approveMessage = (messageId: string, command: string) => {
  const msg = getMessagesLog().find((message) => message.messageId === messageId);
  if (!msg) return false;
  if (msg.kind === 'request' && reliableRequests.get(messageId)) return false;

  const updated = updateMessage(messageId, {
    command,
    payload: { ...msg.payload, instruction: command },
    status: 'queued',
    error: undefined,
  });
  if (!updated) return false;

  if (updated.kind === 'request') {
    return reliableRequests.submit(updated);
  }
  deliveryQueue.enqueue(updated.to, { command, messageId });
  return true;
};
