import { publishEvent } from '@api-hub/event-platform';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { extractCorrelationId } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';

import { configureEventRuntime } from '../events/bootstrap/event-runtime';
import { ALERT_CREATE_INGEST_EVENT_DETAIL_TYPE } from '../events/constants/alert-create-ingest.constants';
import { CreateAlertEventSchema } from '../events/inbound/alert-create-ingest.event';
import { alertCreateIngestPayloadSchema } from '../events/inbound/alert-create-ingest.payload';

configureEventRuntime();

/** Dev/Postman: POST body → publishEvent(CreateAlert.v1) → onCreateAlert consumer. */
export async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = extractCorrelationId(event);

  try {
    const payload = alertCreateIngestPayloadSchema.parse(JSON.parse(event.body ?? '{}'));

    await publishEvent(CreateAlertEventSchema, payload, {
      meta: {
        correlationId,
        tenantId: payload.organizationId,
      },
      idempotencyKey: payload.inputEventId.trim(),
    });

    return ApiResponse.ok(
      {
        detailType: ALERT_CREATE_INGEST_EVENT_DETAIL_TYPE,
        inputEventId: payload.inputEventId,
      },
      { title: 'Accepted', description: 'CreateAlert.v1 published', severity: 'INFO' },
      { correlationId },
    );
  } catch (err) {
    return ApiResponse.error(
      400,
      {
        title: 'Bad Request',
        description: err instanceof Error ? err.message : 'Publish failed',
        severity: 'ERROR',
      },
      { correlationId },
      { code: 'BAD_REQUEST' },
    );
  }
}
