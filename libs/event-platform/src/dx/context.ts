import type { EventConsumer } from '../sdk/consumer/event-consumer';
import type { EventPublisher } from '../sdk/publisher/event-publisher';

type DxRuntime = {
  publisher: EventPublisher;
  consumer: EventConsumer;
};

let runtime: DxRuntime | null = null;

export function setDxRuntime(next: DxRuntime): void {
  runtime = next;
}

export function getDxRuntimeOrThrow(): DxRuntime {
  if (!runtime) {
    throw new Error(
      'Event DX not configured. Call configureEventDx(...) before publishEvent or onEvent.',
    );
  }
  return runtime;
}
