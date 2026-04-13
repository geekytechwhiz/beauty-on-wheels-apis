import { buildPublishEnvelope } from './build-publish-envelope';
import type { EventPublishAdapter } from './event-publish-adapter';
import type { PublishInput } from './publish-input';

export type EventPublisherDeps = {
  adapter: EventPublishAdapter;
};

export class EventPublisher {
  constructor(private readonly deps: EventPublisherDeps) {}

  async publish<T>(input: PublishInput<T>): Promise<void> {
    const event = buildPublishEnvelope(input);
    await this.deps.adapter.publish(event);
  }
}
