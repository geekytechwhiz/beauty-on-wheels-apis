import { logEventOperation } from '@api-hub/observability';

import type { EventTransport } from '../core/schema/define-event';
import type { EventPublisher } from '../sdk/publisher/event-publisher';
import type { PublishInput } from '../typings/publisher.types';
import type { PublishPlan } from './routing';

export type PublishOrchestratorInput<TPayload> = PublishInput<TPayload> & {
  eventId?: string;
  operation?: string;
};

export async function publishWithPlan<TPayload>(
  publishers: Partial<Record<EventTransport, EventPublisher>>,
  plan: PublishPlan,
  input: PublishOrchestratorInput<TPayload>,
): Promise<void> {
  const failures: Array<{ transport: EventTransport; error: unknown }> = [];

  for (const transport of plan.transports) {
    const publisher = publishers[transport];
    if (!publisher) {
      const error = new Error(`Publisher for transport "${transport}" not found`);
      failures.push({ transport, error });
      logEventOperation({
        operation: input.operation ?? 'event.publish',
        outcome: 'failure',
        eventId: input.eventId ?? '',
        eventType: input.eventType,
        transport,
        correlationId: input.meta?.correlationId ?? '',
        traceId: input.meta?.traceId ?? '',
      });
      continue;
    }

    try {
      await publisher.publish(input);
      logEventOperation({
        operation: input.operation ?? 'event.publish',
        outcome: 'success',
        eventId: input.eventId ?? '',
        eventType: input.eventType,
        transport,
        correlationId: input.meta?.correlationId ?? '',
        traceId: input.meta?.traceId ?? '',
      });
    } catch (error) {
      failures.push({ transport, error });
      logEventOperation({
        operation: input.operation ?? 'event.publish',
        outcome: 'failure',
        eventId: input.eventId ?? '',
        eventType: input.eventType,
        transport,
        correlationId: input.meta?.correlationId ?? '',
        traceId: input.meta?.traceId ?? '',
      });
    }
  }

  if (failures.length > 0) {
    const first = failures[0];
    throw first.error;
  }
}
