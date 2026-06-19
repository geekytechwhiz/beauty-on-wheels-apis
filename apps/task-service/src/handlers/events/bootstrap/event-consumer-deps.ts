import {
  createDefaultSqsDlqStrategy,
  type EventConsumerDeps,
} from '@api-hub/event-platform';

let cachedConsumerOverrides: Partial<EventConsumerDeps> | undefined;

/**
 * Shared EventBridge consumer overrides: SQS DLQ strategy.
 * Idempotency is enforced by task-core conditional writes (natural keys / generationHash),
 * not a separate idempotency table.
 */
export function buildTaskEventConsumerDeps(): Partial<EventConsumerDeps> {
  if (cachedConsumerOverrides) {
    return cachedConsumerOverrides;
  }

  const dlqStrategy = createDefaultSqsDlqStrategy();

  cachedConsumerOverrides = {
    ...(dlqStrategy
      ? { dlq: { enabled: true, strategy: dlqStrategy } }
      : { dlq: { enabled: false } }),
  };

  return cachedConsumerOverrides;
}

/** Resets cached deps (tests). */
export function resetTaskEventConsumerDepsCache(): void {
  cachedConsumerOverrides = undefined;
}
