import { BaseEvent } from '../../typings/base-event.types';

export function createEventRouter(
  registry: Record<string, (event: BaseEvent<any>) => Promise<void>>
) {
  return function route(event: BaseEvent<any>) {
    const handler = registry[event.eventType];

    if (!handler) {
      throw new Error(`No handler registered for ${event.eventType}`);
    }

    return handler;
  };
}