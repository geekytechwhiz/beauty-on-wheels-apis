import {
  onEvent,
  SERVICE_VISIT_EVENT_OPERATIONS,
  ServiceVisitActivatedEvent,
  ServiceVisitArchivedEvent,
  ServiceVisitCreatedEvent,
  ServiceVisitPausedEvent,
  ServiceVisitUpdatedEvent,
  createDefaultSqsDlqStrategy,
  type EventConsumerDeps,
  type ServiceVisitSnapshot,
} from '@api-hub/event-platform';
import { createLogger } from '@api-hub/observability';
import { ConditionalWriteConflictError } from '@api-hub/utils';

import { getVisitProjectionRepository } from '../repositories/visit-projections.repository';

const logger = createLogger({
  service: 'availability-service-visit-projection',
  redactPII: true,
});

export function createServiceVisitProjectionHandler(deps?: { consumer?: Partial<EventConsumerDeps> }) {
  const strategy = createDefaultSqsDlqStrategy();
  return onEvent({
    operation: SERVICE_VISIT_EVENT_OPERATIONS.PROJECTION_CONSUME,
    consumer: {
      ...deps?.consumer,
      retry: { maxAttempts: 3, strategy: 'exponential', delayMs: 200 },
      dlq: strategy ? { enabled: true, strategy } : { enabled: false },
    },
    events: [
      ServiceVisitCreatedEvent,
      ServiceVisitUpdatedEvent,
      ServiceVisitActivatedEvent,
      ServiceVisitPausedEvent,
      ServiceVisitArchivedEvent,
    ].map((schema) => ({
      schema,
      handler: async (event) => {
        const snapshotEvent = event as ServiceVisitSnapshot & { meta: { correlationId: string } };
        const { meta, ...snapshot } = snapshotEvent;
        try {
          const applied = await getVisitProjectionRepository().apply(snapshot);
          logger.info({
            event: applied ? 'service_visit_projection_applied' : 'service_visit_projection_ignored',
            correlationId: meta.correlationId,
            vendorId: snapshot.vendorId,
            visitId: snapshot.visitId,
            configurationVersion: snapshot.configurationVersion,
            status: snapshot.status,
          });
        } catch (error) {
          if (error instanceof ConditionalWriteConflictError) {
            logger.info({
              event: 'service_visit_projection_stale',
              correlationId: meta.correlationId,
              vendorId: snapshot.vendorId,
              visitId: snapshot.visitId,
              configurationVersion: snapshot.configurationVersion,
            });
            return;
          }
          logger.error({
            event: 'service_visit_projection_failed',
            correlationId: meta.correlationId,
            vendorId: snapshot.vendorId,
            visitId: snapshot.visitId,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    })),
  });
}

export const handler = createServiceVisitProjectionHandler();
