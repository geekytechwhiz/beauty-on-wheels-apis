import { AlertService } from '@api-hub/alert-core';
import { ALERT_REALTIME_EVENTS, onEvent } from '@api-hub/event-platform';

import { buildAlertEventConsumerDeps } from '../../bootstrap/event-consumer-deps';
import { configureEventRuntime } from '../../bootstrap/event-runtime';
import type { AlertCreateIngestPayload } from '../../inbound/alert-create-ingest.payload';
import { CreateAlertEventSchema } from '../../inbound/alert-create-ingest.event';
import { mapIngestPayloadToCreateAlert } from '../../mappers/alert-event-ingest.mapper';
import { publishAlertIntents } from '../../publisher/alert-publisher';
import { alertCreatedRealtimeTransformer } from '../../realtime/alert-created-realtime.transformer';
import { alertRecipientResolver } from '../../realtime/alert-recipient.resolver';
import { getAlertRealtimeAggregationPublisher } from '../../realtime/alert-realtime.deps';

configureEventRuntime();

const alertService = new AlertService();

const realtimeEnabled = process.env.ALERT_REALTIME_ENABLED === 'true';

export async function processCreateAlert(payload: AlertCreateIngestPayload): Promise<void> {
  const { publishIntents, duplicate } = await alertService.createAlert(
    mapIngestPayloadToCreateAlert(payload),
  );

  if (!duplicate) {
    // await publishAlertIntents(publishIntents);
  }
}

export const handler = onEvent({
  operation: ALERT_REALTIME_EVENTS.ALERT_CREATED,
  consumer: {
    ...buildAlertEventConsumerDeps(),
    ...(realtimeEnabled && {
      realtimeAggregationPublisher: getAlertRealtimeAggregationPublisher(),
    }),
  },
  realtime: {
    enabled: realtimeEnabled,
    resolver: alertRecipientResolver,
    transformer: alertCreatedRealtimeTransformer,
  },
  events: [
    {
      schema: CreateAlertEventSchema,
      handler: async (input) => {
        const { meta: _meta, ...payload } = input;
        await processCreateAlert(payload as AlertCreateIngestPayload);
      },
    },
  ],
});

export const main = handler;
