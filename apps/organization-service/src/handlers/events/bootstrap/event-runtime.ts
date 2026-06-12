import { configureEventPlatform, EventBridgeAdapter } from '@api-hub/event-platform';

let configured = false;

/**
 * Wires `@api-hub/event-platform` to the organization-service EventBridge bus.
 * Mirrors `apps/alert-service/src/handlers/events/bootstrap/event-runtime.ts`.
 */
export function configureEventRuntime(): void {
  if (configured) {
    return;
  }

  const eventBusName = process.env.EVENT_BUS?.trim();
  if (!eventBusName) {
    throw new Error('EVENT_BUS is not configured');
  }

  configureEventPlatform({
    publishers: {
      eventbridge: new EventBridgeAdapter({
        eventBusName,
        source: 'organization-service',
      }),
    },
  });

  configured = true;
}

/** Resets singleton (tests). */
export function resetEventRuntimeForTests(): void {
  configured = false;
}
