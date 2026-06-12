export const STARLIGHT_START_TAG = '[[STARLIGHT-MSG]]';
export const STARLIGHT_END_TAG = '[[END]]';

export interface StarlightEnvelope {
  from?: string;
  to?: string;
  command?: string;
  type?: string;
}

export interface ParsedEnvelope {
  sourceId: string;
  envelope: StarlightEnvelope;
}

export interface EnvelopeParseError {
  sourceId: string;
  payload: string;
  error: unknown;
}

const MAX_BUFFER_LENGTH = 1024 * 1024;

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
