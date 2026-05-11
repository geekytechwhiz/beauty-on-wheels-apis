import type { TemplateEvent } from './events/template.events';

export type TemplateOutboxStatus = 'PENDING' | 'SENT';

export interface TemplateOutboxEventRecord {
  eventId: string;
  payload: TemplateEvent;
  status: TemplateOutboxStatus;
  createdAt: string;
  sentAt?: string;
}
