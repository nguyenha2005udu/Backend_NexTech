import { PoisonMessageError } from './errors';

// Định dạng thông điệp và tên topology (NT.MESSAGING API_Spec §1, §2).

export const EVENTS_EXCHANGE = 'nextech.events';
export const RETRY_EXCHANGE = 'nextech.retry';
export const DLQ_EXCHANGE = 'nextech.dlq';

export interface EventEnvelope<T = Record<string, unknown>> {
  event_id: string;
  type: string;
  version: number;
  occurred_at: string;
  source: string;
  request_id: string | null;
  data: T;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Không parse được hoặc thiếu trường bắt buộc: PoisonMessageError (vào DLQ ngay, không thử lại). */
export function parseEnvelope(content: Buffer | string): EventEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(content.toString());
  } catch {
    throw new PoisonMessageError('Thông điệp không phải JSON');
  }
  const e = raw as Partial<EventEnvelope> | null;
  if (
    !e ||
    typeof e !== 'object' ||
    typeof e.event_id !== 'string' ||
    !UUID_RE.test(e.event_id) ||
    typeof e.type !== 'string' ||
    !e.data ||
    typeof e.data !== 'object'
  ) {
    throw new PoisonMessageError('Thông điệp thiếu trường bắt buộc');
  }
  return e as EventEnvelope;
}
