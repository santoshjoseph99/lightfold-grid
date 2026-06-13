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

// Bounded in-memory message history. Durable storage arrives in Milestone 4.
const messagesLog = new BoundedMessageHistory<StarlightMessage>(DEFAULT_MESSAGE_HISTORY_LIMIT);

// Configuration variables (can be modified in Settings)
let commandBlocklist: string[] = ['rm -rf /', 'sudo rm', 'mkfs'];
let trustedCommands: string[] = ['git status', 'ls -la', 'pwd', 'npm run build'];
let isAutopilot = false;
let routingConnections: Record<string, string[]> = {};

export const getMessagesLog = () => messagesLog.values();
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
};

const updateMessage = (
  messageId: string,
  patch: Partial<Omit<StarlightMessage, 'id' | 'messageId'>>
) => {
  const updated = messagesLog.update(messageId, (msg) => ({ ...msg, ...patch }));
  if (updated) notifyMessageListeners(updated);
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
  },
  undefined,
  {},
  Date.now,
  {
    canDeliver: (targetId) => agentLifecycle.canAcceptTask(targetId),
    onTaskStarted: (targetId, taskId) => agentLifecycle.taskStarted(targetId, taskId),
  }
);

export const getDeadLetters = () => reliableRequests.getDeadLetters();
export const getReliabilitySettings = () => reliableRequests.getOptions();
export const setReliabilitySettings = (settings: ReliabilityOptions) => reliableRequests.configure(settings);
export const getAgentLifecycles = () => agentLifecycle.values();
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
