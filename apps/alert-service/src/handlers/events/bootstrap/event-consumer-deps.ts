import {
  createDefaultSqsDlqStrategy,
  type EventConsumerDeps,
} from '@api-hub/event-platform';

let cachedConsumerOverrides: Partial<EventConsumerDeps> | undefined;

/**
 * Shared EventBridge consumer overrides: SQS DLQ strategy.
 * Idempotency is enforced by alert-core conditional writes on the EVENT# record
 * (see AlertRepository.createAlert), not a separate idempotency table.
 */
export function buildAlertEventConsumerDeps(): Partial<EventConsumerDeps> {
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
export function resetAlertEventConsumerDepsCache(): void {
  cachedConsumerOverrides = undefined;
}
