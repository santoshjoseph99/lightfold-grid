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
let brokerStateInitialized = false;
let brokerRetentionLimit = 5_000;

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
    canDeliver: (targetId) => agentLifecycle.canAcceptTask(targetId),
    onTaskStarted: (targetId, taskId) => agentLifecycle.taskStarted(targetId, taskId),
  }
);

const notifyWorkflowListeners = (workflow: WorkflowRecord) => {
  workflowListeners.forEach((listener) => listener(workflow));
  persist((window as any).electronAPI?.persistBrokerWorkflow(workflow));
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
  onDispatch: (task) => dispatchWorkflowTask(task),
});

const findWorkflowTaskByMessageId = (messageId: string): WorkflowTaskRecord | undefined => {
  return workflowEngine.values()
    .flatMap((workflow) => workflow.tasks)
    .find((task) => task.messageId === messageId);
};

const dispatchWorkflowTask = (task: WorkflowTaskRecord) => {
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
      instruction: task.goal,
      data: {
        workflowId: task.workflowId,
        workflowTaskId: task.id,
        completionCriteria: task.completionCriteria,
      },
    },
    attempt: 1,
    timestamp: Date.now(),
    command: task.goal,
    type: 'request',
    status: 'queued',
  };
  workflowEngine.assignTask(task.workflowId, task.id, messageId);
  appendMessage(message);
  reliableRequests.submit(message);
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
  const knownAgents = new Set(agentLifecycle.values().map((agent) => agent.agentId));
  const unknownOwner = knownAgents.size > 0
    ? definition.tasks.find((task) => !knownAgents.has(task.owner))
    : undefined;
  if (unknownOwner) throw new WorkflowValidationError(`Workflow task ${unknownOwner.id} targets unknown agent ${unknownOwner.owner}.`);
  return workflowEngine.create(definition);
};
export const approveWorkflowTask = (workflowId: string, taskId: string) => workflowEngine.approveTask(workflowId, taskId);
export const retryWorkflowTask = (workflowId: string, taskId: string) => workflowEngine.retryTask(workflowId, taskId);
export const reassignWorkflowTask = (workflowId: string, taskId: string, owner: string) => {
  if (!agentLifecycle.get(owner)) return false;
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
export const subscribeToAgentLifecycle = (listener: (record: AgentLifecycleRecord) => void) => {
  lifecycleListeners.add(listener);
  return () => {
    lifecycleListeners.delete(listener);
  };
};
export const registerAgent = (agentId: string) => agentLifecycle.register(agentId);
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
    const messages = (snapshot.messages || []) as StarlightMessage[];
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
        workflowEngine.submitResult(workflowTask.workflowId, workflowTask.id, {
          summary: msg.payload.summary,
          artifacts: msg.payload.artifacts,
        });
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
