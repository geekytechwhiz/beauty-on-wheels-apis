import type { TemplateOutboxStore } from '../template-outbox.port';
import type { TemplateEventPublisher } from '../ports/template-event-publisher.port';

export interface ProcessTemplateOutboxResult {
  processed: number;
}

export class ProcessTemplateOutboxUseCase {
  constructor(
    private readonly outboxStore: TemplateOutboxStore,
    private readonly eventPublisher: TemplateEventPublisher,
  ) {}

  async execute(limit = 25): Promise<ProcessTemplateOutboxResult> {
    const events = await this.outboxStore.listPendingEvents(limit);

    for (const event of events) {
      await this.eventPublisher.publish(event.payload);
      await this.outboxStore.markEventSent(event.eventId, new Date().toISOString());
    }

    return { processed: events.length };
  }
}
