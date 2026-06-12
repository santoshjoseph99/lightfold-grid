import { subscribeToStream } from './terminalRegistry';
import { isRouteAllowed, PtyDeliveryQueue, StarlightEnvelopeParser } from './brokerCore';

export interface StarlightMessage {
  id: string;
  from: string;
  to: string;
  command: string;
  type: string;
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed';
  timestamp: number;
  error?: string;
}

const messageListeners = new Set<(msg: StarlightMessage) => void>();
const queueListeners = new Set<(paneId: string, queue: string[]) => void>();

// In-memory message logs
let messagesLog: StarlightMessage[] = [];

// Configuration variables (can be modified in Settings)
let commandBlocklist: string[] = ['rm -rf /', 'sudo rm', 'mkfs'];
let trustedCommands: string[] = ['git status', 'ls -la', 'pwd', 'npm run build'];
let isAutopilot = false;
let routingConnections: Record<string, string[]> = {};

export const getMessagesLog = () => messagesLog;
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

const notifyQueueListeners = (paneId: string) => {
  const q = deliveryQueue.getQueue(paneId);
  queueListeners.forEach((l) => l(paneId, q.map((entry) => entry.command)));
};

const parser = new StarlightEnvelopeParser();
const deliveryQueue = new PtyDeliveryQueue(
  (paneId, data) => (window as any).electronAPI.writePty(paneId, data),
  (paneId) => notifyQueueListeners(paneId),
  (entry, status, error) => {
    const msg = entry.messageId ? messagesLog.find((item) => item.id === entry.messageId) : undefined;
    if (!msg) return;
    msg.status = status;
    msg.error = error;
    notifyMessageListeners(msg);
  }
);

// Start listening to the raw terminal output stream
subscribeToStream((id, chunk) => {
  const result = parser.push(id, chunk);

  result.errors.forEach(({ error, payload }) => {
    console.error('Failed to parse intercepted broker JSON:', error, payload);
  });

  for (const { sourceId, envelope } of result.messages) {
    const newMsg: StarlightMessage = {
      id: Math.random().toString(36).substring(2, 9),
      // The physical PTY is authoritative. This prevents stale prompts or an
      // agent-generated "from" value from impersonating another route.
      from: sourceId,
      to: envelope.to || 'broadcast',
      command: envelope.command || '',
      type: envelope.type || 'instruction',
      status: 'pending',
      timestamp: Date.now(),
    };

    messagesLog = [...messagesLog, newMsg];
    notifyMessageListeners(newMsg);
    routeMessage(newMsg);
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
    msg.status = 'rejected';
    msg.error = `Routing Blocked: No connection path configured from ${sourcePane} to ${targetPane}.`;
    notifyMessageListeners(msg);
    return;
  }
  
  // Check Blocklists
  const isBlocked = commandBlocklist.some(cmd => msg.command.toLowerCase().includes(cmd.toLowerCase()));
  if (isBlocked) {
    msg.status = 'rejected';
    msg.error = 'Blocked command filter matched.';
    notifyMessageListeners(msg);
    return;
  }
  
  // Check Trusted Command or Autopilot
  const isTrusted = trustedCommands.some(cmd => cmd.toLowerCase() === msg.command.trim().toLowerCase());
  
  if (isAutopilot || isTrusted) {
    msg.status = 'approved';
    notifyMessageListeners(msg);
    enqueueCommand(targetPane, msg.command, msg.id);
  } else {
    // Falls to Gatekeeper modal approval
    // (UI component listens to messagesLog with 'pending' status)
  }
};

// Queue commands for a terminal pane
export const enqueueCommand = (paneId: string, command: string, msgId?: string) => {
  if (msgId) {
    const msg = messagesLog.find(m => m.id === msgId);
    if (msg) {
      msg.status = 'approved';
      notifyMessageListeners(msg);
    }
  }

  deliveryQueue.enqueue(paneId, { command, messageId: msgId });
};

export const rejectMessage = (msgId: string) => {
  const msg = messagesLog.find(m => m.id === msgId);
  if (msg) {
    msg.status = 'rejected';
    notifyMessageListeners(msg);
  }
};
