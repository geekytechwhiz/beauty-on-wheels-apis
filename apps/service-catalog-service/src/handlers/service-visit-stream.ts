import {
  createDynamoStreamHandler,
  publishEvent,
  SERVICE_VISIT_EVENT_OPERATIONS,
  ServiceVisitActivatedEvent,
  ServiceVisitArchivedEvent,
  ServiceVisitCreatedEvent,
  ServiceVisitPausedEvent,
  ServiceVisitUpdatedEvent,
  serviceVisitEventType,
  serviceVisitIdempotencyKey,
  type EventConsumerDeps,
  type ServiceVisitSnapshot,
} from '@api-hub/event-platform';

import { ensureCatalogEventPlatform } from '../events/configure-catalog-event-platform';
import { mapServiceVisitStreamRecord } from '../events/map-service-visit-stream';

const VISIT_EVENT_BY_TYPE = {
  'ServiceVisit.Created': ServiceVisitCreatedEvent,
  'ServiceVisit.Updated': ServiceVisitUpdatedEvent,
  'ServiceVisit.Activated': ServiceVisitActivatedEvent,
  'ServiceVisit.Paused': ServiceVisitPausedEvent,
  'ServiceVisit.Archived': ServiceVisitArchivedEvent,
} as const;

async function publishVisit(snapshot: ServiceVisitSnapshot, correlationId: string): Promise<void> {
  ensureCatalogEventPlatform();
  const eventType = serviceVisitEventType(snapshot.change);
  await publishEvent(VISIT_EVENT_BY_TYPE[eventType], snapshot, {
    idempotencyKey: serviceVisitIdempotencyKey(
      snapshot.visitId,
      snapshot.configurationVersion,
      snapshot.change,
    ),
    meta: { correlationId },
  });
}

export function createServiceVisitStreamHandler(deps?: { consumer?: Partial<EventConsumerDeps> }) {
  return createDynamoStreamHandler({
    operation: SERVICE_VISIT_EVENT_OPERATIONS.STREAM_PUBLISH,
    consumer: {
      ...deps?.consumer,
      mapRawToBaseEvent: mapServiceVisitStreamRecord,
    },
    events: [
      ServiceVisitCreatedEvent,
      ServiceVisitUpdatedEvent,
      ServiceVisitActivatedEvent,
      ServiceVisitPausedEvent,
      ServiceVisitArchivedEvent,
    ].map((schema) => ({
      table: 'service-catalog',
      eventName: ['INSERT', 'MODIFY'] as Array<'INSERT' | 'MODIFY'>,
      schema,
      handler: async (event) => {
        const snapshot = event as ServiceVisitSnapshot & { meta: { correlationId: string } };
        const { meta, ...payload } = snapshot;
        await publishVisit(payload, meta.correlationId);
      },
    })),
  });
}

export const handler = createServiceVisitStreamHandler();
