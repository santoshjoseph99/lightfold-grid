import { subscribeToStream } from './terminalRegistry';
import {
  AgentMessage,
  BoundedMessageHistory,
  createProtocolId,
  DEFAULT_MESSAGE_HISTORY_LIMIT,
  getMessageInstruction,
  isRouteAllowed,
  normalizeAgentMessage,
  ProtocolValidationError,
  PtyDeliveryQueue,
  StarlightEnvelopeParser,
} from './brokerCore';

export type BrokerMessageStatus = 'pending' | 'approved' | 'rejected' | 'executing' | 'completed';

export interface StarlightMessage extends AgentMessage {
  id: string;
  command: string;
  type: string;
  status: BrokerMessageStatus;
  error?: string;
}

const messageListeners = new Set<(msg: StarlightMessage) => void>();
const queueListeners = new Set<(paneId: string, queue: string[]) => void>();

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
  patch: Partial<Pick<StarlightMessage, 'status' | 'error' | 'command'>>
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
    status: 'rejected',
    error: description,
  };
  appendMessage(protocolError);
};

const notifyQueueListeners = (paneId: string) => {
  const q = deliveryQueue.getQueue(paneId);
  queueListeners.forEach((l) => l(paneId, q.map((entry) => entry.command)));
};

const parser = new StarlightEnvelopeParser();
const deliveryQueue = new PtyDeliveryQueue(
  (paneId, data) => (window as any).electronAPI.writePty(paneId, data),
  (paneId) => notifyQueueListeners(paneId),
  (entry, status, error) => {
    if (!entry.messageId) return;
    updateMessage(entry.messageId, { status, error });
  }
);

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
      routeMessage(newMsg);
    } catch (error) {
      console.error('Rejected invalid broker message:', error, envelope);
      recordProtocolError(sourceId, error);
    }
  }
});

// Routing logic
const routeMessage = (msg: StarlightMessage) => {
  const targetPane = msg.to;
  const sourcePane = msg.from;
  
  // Check connection matrix routing restrictions
  // If the routing matrix has connections configured for source, verify target.
  const isConnected = isRouteAllowed(routingConnections, sourcePane, targetPane);
  
  if (!isConnected) {
    updateMessage(msg.messageId, {
      status: 'rejected',
      error: `Routing Blocked: No connection path configured from ${sourcePane} to ${targetPane}.`,
    });
    return;
  }
  
  // Check Blocklists
  const isBlocked = commandBlocklist.some(cmd => msg.command.toLowerCase().includes(cmd.toLowerCase()));
  if (isBlocked) {
    updateMessage(msg.messageId, { status: 'rejected', error: 'Blocked command filter matched.' });
    return;
  }
  
  // Check Trusted Command or Autopilot
  const isTrusted = trustedCommands.some(cmd => cmd.toLowerCase() === msg.command.trim().toLowerCase());
  
  if (isAutopilot || isTrusted) {
    updateMessage(msg.messageId, { status: 'approved' });
    enqueueCommand(targetPane, msg.command, msg.messageId);
  } else {
    // Falls to Gatekeeper modal approval
    // (UI component listens to messagesLog with 'pending' status)
  }
};

// Queue commands for a terminal pane
export const enqueueCommand = (paneId: string, command: string, msgId?: string) => {
  if (msgId) {
    updateMessage(msgId, { status: 'approved', command });
  }

  deliveryQueue.enqueue(paneId, { command, messageId: msgId });
};

export const rejectMessage = (msgId: string) => {
  updateMessage(msgId, { status: 'rejected' });
};
