import { AlertService } from '@api-hub/alert-core';
import { onEvent } from '@api-hub/event-platform';

import { buildAlertEventConsumerDeps } from '../../bootstrap/event-consumer-deps';
import { configureEventRuntime } from '../../bootstrap/event-runtime';
import type { AlertCreateIngestPayload } from '../../inbound/alert-create-ingest.payload';
import { CreateAlertEventSchema } from '../../inbound/alert-create-ingest.event';
import { mapIngestPayloadToCreateAlert } from '../../mappers/alert-event-ingest.mapper';
import { publishAlertIntents } from '../../publisher/alert-publisher';

configureEventRuntime();

const alertService = new AlertService();

export async function processCreateAlert(payload: AlertCreateIngestPayload): Promise<void> {
  const { publishIntents, duplicate } = await alertService.createAlert(
    mapIngestPayloadToCreateAlert(payload),
  );

  if (!duplicate) {
    await publishAlertIntents(publishIntents);
  }
}

export const handler = onEvent({
  operation: 'alert.create.processed',
  consumer: buildAlertEventConsumerDeps(),
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
