import { publishEvent } from '@api-hub/event-platform';
import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

import { configureEventRuntime } from '../events/bootstrap/event-runtime';
import { ALERT_CREATE_INGEST_EVENT_DETAIL_TYPE } from '../events/constants/alert-create-ingest.constants';
import { CreateAlertEventSchema } from '../events/inbound/alert-create-ingest.event';
import {
  alertCreateIngestPayloadSchema,
  type AlertCreateIngestPayload,
} from '../events/inbound/alert-create-ingest.payload';

configureEventRuntime();

/** Dev/Postman: POST body → publishEvent(CreateAlert.v1) → onCreateAlert consumer. */
const handler = async (req: LambdaRequest) => {
  const payload = req.body as AlertCreateIngestPayload;

  await publishEvent(CreateAlertEventSchema, payload, {
    meta: {
      tenantId: payload.organizationId,
    },
    idempotencyKey: payload.inputEventId.trim(),
  });

  return {
    detailType: ALERT_CREATE_INGEST_EVENT_DETAIL_TYPE,
    inputEventId: payload.inputEventId,
  };
};

export const main = withApiHandler(
  {
    operation: 'alert.testPublishCreateAlertIngest',
    bodySchema: alertCreateIngestPayloadSchema,
  },
  handler,
);

export default main;
