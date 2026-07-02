import { configureEventPlatform, EventBridgeAdapter } from '@api-hub/event-platform';

let configured = false;

export function configureEventRuntime(): void {
  if (configured) {
    return;
  }

  configureEventPlatform({
    publishers: {
      eventbridge: new EventBridgeAdapter({
        eventBusName: process.env.TASK_EVENT_BUS_NAME!,
        source: 'task-service',
      }),
    },
  });

  configured = true;
}

/** Resets singleton (tests). */
export function resetEventRuntimeConfigured(): void {
  configured = false;
}
