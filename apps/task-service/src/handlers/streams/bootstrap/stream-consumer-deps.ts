import type { EventConsumerDeps } from '@api-hub/event-platform';

let cachedConsumerOverrides: Partial<EventConsumerDeps> | undefined;

export function buildTaskStreamConsumerDeps(): Partial<EventConsumerDeps> {
  if (cachedConsumerOverrides) {
    return cachedConsumerOverrides;
  }

  cachedConsumerOverrides = {
    retry: { maxAttempts: 3, strategy: 'exponential', delayMs: 200 },
    dlq: { enabled: false },
  };

  return cachedConsumerOverrides;
}

export function resetTaskStreamConsumerDepsCache(): void {
  cachedConsumerOverrides = undefined;
}
