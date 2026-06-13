export const STARLIGHT_START_TAG = '[[STARLIGHT-MSG]]';
export const STARLIGHT_END_TAG = '[[END]]';
export const AGENT_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_MESSAGE_HISTORY_LIMIT = 500;

export interface StarlightEnvelope {
  from?: string;
  to?: string;
  command?: string;
  type?: string;
}

export type AgentMessageKind = 'request' | 'ack' | 'progress' | 'result' | 'error' | 'cancel';

export interface AgentMessagePayload {
  instruction?: string;
  summary?: string;
  artifacts?: string[];
  data?: unknown;
}

export interface AgentMessage {
  protocolVersion: typeof AGENT_PROTOCOL_VERSION;
  messageId: string;
  taskId: string;
  parentTaskId?: string;
  correlationId?: string;
  from: string;
  to: string;
  kind: AgentMessageKind;
  payload: AgentMessagePayload;
  attempt: number;
  timestamp: number;
}

export interface ParsedEnvelope {
  sourceId: string;
  envelope: unknown;
}

export interface EnvelopeParseError {
  sourceId: string;
  payload: string;
  error: unknown;
}

const MAX_BUFFER_LENGTH = 1024 * 1024;
const MESSAGE_KINDS = new Set<AgentMessageKind>([
  'request',
  'ack',
  'progress',
  'result',
  'error',
  'cancel',
]);

export class ProtocolValidationError extends Error {
  readonly code: string;

  constructor(
    message: string,
    code: string
  ) {
    super(message);
    this.name = 'ProtocolValidationError';
    this.code = code;
  }
}

export interface NormalizeMessageOptions {
  sourceId: string;
  createId?: () => string;
  now?: () => number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const optionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProtocolValidationError(`${field} must be a non-empty string.`, 'INVALID_FIELD');
  }
  return value.trim();
};

const requiredString = (value: unknown, field: string): string => {
  const result = optionalString(value, field);
  if (!result) {
    throw new ProtocolValidationError(`${field} is required.`, 'MISSING_FIELD');
  }
  return result;
};

const validatePayload = (value: unknown): AgentMessagePayload => {
  if (!isRecord(value)) {
    throw new ProtocolValidationError('payload must be an object.', 'INVALID_PAYLOAD');
  }

  const instruction = optionalString(value.instruction, 'payload.instruction');
  const summary = optionalString(value.summary, 'payload.summary');
  let artifacts: string[] | undefined;
  if (value.artifacts !== undefined) {
    if (!Array.isArray(value.artifacts) || value.artifacts.some((item) => typeof item !== 'string')) {
      throw new ProtocolValidationError('payload.artifacts must be an array of strings.', 'INVALID_PAYLOAD');
    }
    artifacts = [...value.artifacts];
  }

  return {
    instruction,
    summary,
    artifacts,
    data: value.data,
  };
};

const legacyKind = (type: unknown): AgentMessageKind => {
  if (typeof type !== 'string') return 'request';
  const normalized = type.toLowerCase();
  if (['result', 'finish', 'approve'].includes(normalized)) return 'result';
  if (['progress', 'logs', 'status'].includes(normalized)) return 'progress';
  if (['error', 'failure', 'chaos_fail'].includes(normalized)) return 'error';
  if (normalized === 'cancel') return 'cancel';
  if (normalized === 'ack') return 'ack';
  return 'request';
};

export const createProtocolId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export const normalizeAgentMessage = (
  value: unknown,
  options: NormalizeMessageOptions
): AgentMessage => {
  if (!isRecord(value)) {
    throw new ProtocolValidationError('Message envelope must contain a JSON object.', 'INVALID_ENVELOPE');
  }

  const createId = options.createId || createProtocolId;
  const now = options.now || Date.now;
  const messageId = createId();
  const timestamp = now();

  if (value.protocolVersion === undefined) {
    const command = requiredString(value.command, 'command');
    return {
      protocolVersion: AGENT_PROTOCOL_VERSION,
      messageId,
      taskId: createId(),
      from: options.sourceId,
      to: requiredString(value.to, 'to'),
      kind: legacyKind(value.type),
      payload: {
        instruction: command,
        data: {
          legacy: true,
          legacyType: typeof value.type === 'string' ? value.type : undefined,
        },
      },
      attempt: 1,
      timestamp,
    };
  }

  if (value.protocolVersion !== AGENT_PROTOCOL_VERSION) {
    throw new ProtocolValidationError(
      `Unsupported protocolVersion ${String(value.protocolVersion)}.`,
      'UNSUPPORTED_VERSION'
    );
  }

  if (typeof value.kind !== 'string' || !MESSAGE_KINDS.has(value.kind as AgentMessageKind)) {
    throw new ProtocolValidationError('kind is not supported.', 'INVALID_KIND');
  }
  const kind = value.kind as AgentMessageKind;
  const suppliedTaskId = optionalString(value.taskId, 'taskId');
  if (!suppliedTaskId && kind !== 'request') {
    throw new ProtocolValidationError(`${kind} messages must include taskId.`, 'MISSING_TASK_ID');
  }

  const attempt = value.attempt === undefined ? 1 : value.attempt;
  if (!Number.isInteger(attempt) || (attempt as number) < 1) {
    throw new ProtocolValidationError('attempt must be a positive integer.', 'INVALID_ATTEMPT');
  }

  return {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    messageId,
    taskId: kind === 'request' ? createId() : suppliedTaskId!,
    parentTaskId: optionalString(value.parentTaskId, 'parentTaskId'),
    correlationId: optionalString(value.correlationId, 'correlationId'),
    from: options.sourceId,
    to: requiredString(value.to, 'to'),
    kind,
    payload: validatePayload(value.payload),
    attempt: kind === 'request' ? 1 : attempt as number,
    timestamp,
  };
};

export const getMessageInstruction = (message: AgentMessage): string => {
  if (message.payload.instruction) return message.payload.instruction;
  if (message.payload.summary) return message.payload.summary;
  if (message.payload.data !== undefined) return JSON.stringify(message.payload.data);
  return '';
};

export class BoundedMessageHistory<T extends { messageId: string }> {
  private items: T[] = [];
  private readonly limit: number;

  constructor(limit = DEFAULT_MESSAGE_HISTORY_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Message history limit must be a positive integer.');
    }
    this.limit = limit;
  }

  values(): T[] {
    return [...this.items];
  }

  append(item: T): T {
    this.items = [...this.items, item].slice(-this.limit);
    return item;
  }

  update(messageId: string, update: (item: T) => T): T | undefined {
    const current = this.items.find((item) => item.messageId === messageId);
    if (!current) return undefined;
    const updated = update(current);
    this.items = this.items.map((item) => item.messageId === messageId ? updated : item);
    return updated;
  }
}

export const stripAnsi = (text: string): string => {
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
};

const stripCodeFence = (payload: string): string => {
  const trimmed = payload.trim();
  const withoutOpeningFence = trimmed.replace(/^```(?:json)?\s*/i, '');
  return withoutOpeningFence.replace(/\s*```$/, '').trim();
};

export class StarlightEnvelopeParser {
  private readonly buffers = new Map<string, string>();

  push(sourceId: string, chunk: string): { messages: ParsedEnvelope[]; errors: EnvelopeParseError[] } {
    const messages: ParsedEnvelope[] = [];
    const errors: EnvelopeParseError[] = [];
    let buffer = stripAnsi((this.buffers.get(sourceId) || '') + chunk);

    while (true) {
      const startIndex = buffer.indexOf(STARLIGHT_START_TAG);
      if (startIndex === -1) {
        buffer = buffer.slice(-Math.min(buffer.length, STARLIGHT_START_TAG.length - 1));
        break;
      }

      const payloadStart = startIndex + STARLIGHT_START_TAG.length;
      const endIndex = buffer.indexOf(STARLIGHT_END_TAG, payloadStart);
      if (endIndex === -1) {
        buffer = buffer.slice(startIndex);
        break;
      }

      // Streaming terminal UIs may redraw a partial response before printing the
      // final envelope. Prefer the innermost complete envelope in that case.
      const nestedStartIndex = buffer.lastIndexOf(STARLIGHT_START_TAG, endIndex);
      const effectivePayloadStart = nestedStartIndex > startIndex
        ? nestedStartIndex + STARLIGHT_START_TAG.length
        : payloadStart;
      const payload = stripCodeFence(buffer.slice(effectivePayloadStart, endIndex));
      try {
        const envelope = JSON.parse(payload) as StarlightEnvelope;
        messages.push({ sourceId, envelope });
      } catch (error) {
        errors.push({ sourceId, payload, error });
      }

      buffer = buffer.slice(endIndex + STARLIGHT_END_TAG.length);
    }

    if (buffer.length > MAX_BUFFER_LENGTH) {
      buffer = buffer.slice(-MAX_BUFFER_LENGTH);
    }
    this.buffers.set(sourceId, buffer);

    return { messages, errors };
  }

  reset(sourceId?: string) {
    if (sourceId) {
      this.buffers.delete(sourceId);
      return;
    }
    this.buffers.clear();
  }
}

export const isRouteAllowed = (
  connections: Record<string, string[]>,
  source: string,
  target: string
): boolean => {
  if (Object.keys(connections).length === 0) {
    return true;
  }
  return (connections[source] || []).includes(target);
};

export interface DeliveryEntry {
  command: string;
  messageId?: string;
}

export type DeliveryStatus = 'executing' | 'completed' | 'rejected';

export class PtyDeliveryQueue {
  private readonly queues = new Map<string, DeliveryEntry[]>();
  private readonly processingTargets = new Set<string>();
  private readonly write: (targetId: string, data: string) => Promise<boolean>;
  private readonly onQueueChange: (targetId: string, entries: DeliveryEntry[]) => void;
  private readonly onStatusChange: (
    entry: DeliveryEntry,
    status: DeliveryStatus,
    error?: string
  ) => void;
  private readonly deliveryDelayMs: number;

  constructor(
    write: (targetId: string, data: string) => Promise<boolean>,
    onQueueChange: (targetId: string, entries: DeliveryEntry[]) => void = () => {},
    onStatusChange: (
      entry: DeliveryEntry,
      status: DeliveryStatus,
      error?: string
    ) => void = () => {},
    deliveryDelayMs = 100
  ) {
    this.write = write;
    this.onQueueChange = onQueueChange;
    this.onStatusChange = onStatusChange;
    this.deliveryDelayMs = deliveryDelayMs;
  }

  enqueue(targetId: string, entry: DeliveryEntry) {
    const queue = this.queues.get(targetId) || [];
    this.queues.set(targetId, [...queue, entry]);
    this.notifyQueueChange(targetId);
    void this.process(targetId);
  }

  getQueue(targetId: string): DeliveryEntry[] {
    return [...(this.queues.get(targetId) || [])];
  }

  async waitForIdle(targetId: string): Promise<void> {
    while (this.processingTargets.has(targetId) || this.getQueue(targetId).length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private notifyQueueChange(targetId: string) {
    this.onQueueChange(targetId, this.getQueue(targetId));
  }

  private async process(targetId: string) {
    if (this.processingTargets.has(targetId)) return;
    this.processingTargets.add(targetId);

    try {
      while (true) {
        const queue = this.queues.get(targetId) || [];
        if (queue.length === 0) break;

        const entry = queue[0];
        this.queues.set(targetId, queue.slice(1));
        this.notifyQueueChange(targetId);
        this.onStatusChange(entry, 'executing');

        try {
          const delivered = await this.write(targetId, entry.command + '\r');
          this.onStatusChange(
            entry,
            delivered ? 'completed' : 'rejected',
            delivered ? undefined : `Target pane ${targetId} is not running.`
          );
        } catch (error) {
          this.onStatusChange(
            entry,
            'rejected',
            error instanceof Error ? error.message : String(error)
          );
        }

        if (this.deliveryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.deliveryDelayMs));
        }
      }
    } finally {
      this.processingTargets.delete(targetId);
    }
  }
}
