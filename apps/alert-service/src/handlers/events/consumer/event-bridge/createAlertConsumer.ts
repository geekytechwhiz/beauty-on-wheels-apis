import { AlertService } from '@api-hub/alert-core';
import { onEvent } from '@api-hub/event-platform';
import { createLogger, getContext } from '@api-hub/observability';

import { configureEventRuntime } from '../../bootstrap/event-runtime';
import type { AlertCreateIngestPayload } from '../../inbound/alert-create-ingest.payload';
import { CreateAlertEventSchema } from '../../inbound/alert-create-ingest.event';
import { mapIngestPayloadToCreateAlert } from '../../mappers/alert-event-ingest.mapper';
import { publishAlertIntents } from '../../publisher/alert-publisher';

configureEventRuntime();

const logger = createLogger({ service: 'alert-service', redactPII: false });
const alertService = new AlertService();

export async function processCreateAlert(payload: AlertCreateIngestPayload): Promise<void> {
  const { publishIntents, duplicate } = await alertService.createAlert(
    mapIngestPayloadToCreateAlert(payload),
  );

  if (!duplicate) {
    await publishAlertIntents(publishIntents);
  }
}

export const handler = onEvent(CreateAlertEventSchema, async ({ payload, meta }) => {
  const envelopeMeta = meta as { correlationId?: string; publishedAt?: string; tenantId?: string };
  logger.info({
    event: 'on_create_alert_correlation',
    message: 'Consumer correlation (onCreateAlert)',
    envelopeMetaCorrelationId: envelopeMeta.correlationId,
    envelopeMetaPublishedAt: envelopeMeta.publishedAt,
    envelopeMetaTenantId: envelopeMeta.tenantId,
    loggerContextCorrelationId: getContext().correlationId,
    inputEventId: payload.inputEventId,
  });

  await processCreateAlert(payload);
});

export const main = handler;
