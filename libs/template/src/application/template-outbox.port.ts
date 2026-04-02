import type { TemplateOutboxEventRecord } from '../domain';

export interface TemplateOutboxStore {
  listPendingEvents(limit: number): Promise<TemplateOutboxEventRecord[]>;
  markEventSent(eventId: string, sentAt: string): Promise<void>;
}
