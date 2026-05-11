// core/idempotency/types.ts

export type IdempotencyResult =
  | 'PROCEED'
  | 'DUPLICATE'
  | 'RETRY';

export interface IdempotencyContext {
  eventId: string;
  eventType: string;
  service?: string;
}