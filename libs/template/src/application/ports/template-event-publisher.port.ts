import type { TemplateEvent } from '../../domain';

export interface TemplateEventPublisher {
  publish(event: TemplateEvent): Promise<void>;
}
