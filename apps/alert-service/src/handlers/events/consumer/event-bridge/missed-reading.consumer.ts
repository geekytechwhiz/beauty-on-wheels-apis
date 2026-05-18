import { AlertService } from '@api-hub/alert-core';
import { onEvent } from '@api-hub/event-platform';

import { configureEventRuntime } from '../../bootstrap/event-runtime';
import { MissedReadingEventSchema } from '../../inbound/missed-reading.event';
import { mapMissedReadingToCreateAlert } from '../../mappers/alert-event-ingest.mapper';
import { publishAlertIntents } from '../../publisher/alert-publisher';

configureEventRuntime();

const alertService = new AlertService();

export const handler = onEvent(MissedReadingEventSchema, async (event) => {
  const { publishIntents, duplicate } = await alertService.createAlert(
    mapMissedReadingToCreateAlert(event.payload),
  );

  if (!duplicate) {
    await publishAlertIntents(publishIntents);
  }
});

export const main = handler;