import { EventTransport } from '../core/schema/define-event';

import type { EventConsumer } from '../sdk/consumer/event-consumer';
import type { EventPublisher } from '../sdk/publisher/event-publisher';

export type DxRuntime = { 
  defaultTransport: EventTransport;
 
  publishers: Partial<
    Record<EventTransport, EventPublisher>
  >;
 
  consumer?: EventConsumer;
};

let runtime: DxRuntime | null = null;
 
export function setDxRuntime(
  next: DxRuntime,
): void {
  if (
    !next.publishers ||
    Object.keys(next.publishers).length === 0
  ) {
    throw new Error(
      'At least one event publisher must be configured.'
    );
  }
  runtime = next;
}
 
export function getDxRuntimeOrThrow(): DxRuntime {
  if (!runtime) {
    throw new Error(
      [
        'Event DX runtime not configured.',
        'Call configureEventPlatform(...) during application bootstrap.',
      ].join(' '),
    );
  }

  return runtime;
}