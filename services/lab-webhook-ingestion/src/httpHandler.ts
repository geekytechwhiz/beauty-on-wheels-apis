import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ApiResponse } from '@api-hub/utils';
import { logHttpRequest, serializeError } from '@api-hub/logger';
import { ingestWebhook } from './services/webhookIngestion.service';
import {
  InvalidSignatureError,
  UnknownPartnerError,
  DuplicateEventError,
  InvalidPayloadError,
} from './utils/webhookErrors';
import { webhookPayloadSchema } from './validation/webhook.schema';
import type { Logger } from '@api-hub/logger';

function getRequestId(event: APIGatewayProxyEvent, context?: Context): string {
  const correlation =
    event.headers?.['x-correlation-id'] ??
    event.headers?.['X-Correlation-Id'] ??
    (context && (context as { awsRequestId?: string }).awsRequestId);
  return correlation ?? 'unknown';
}

function responseOpts(event: APIGatewayProxyEvent, requestId: string) {
  return { requestId, event };
}

function parseJsonBody(event: APIGatewayProxyEvent): unknown {
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body ?? {};
  } catch {
    return null;
  }
}

export async function handleIngestWebhook(
  event: APIGatewayProxyEvent,
  context: Context | undefined,
  logger: Logger
): Promise<APIGatewayProxyResult> {
  const requestId = getRequestId(event, context);
  const partnerId = event.pathParameters?.partnerId;

  if (!partnerId) {
    return ApiResponse.badRequest(
      'WEBHOOK.MISSING_PARTNER_ID',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Missing partnerId in path' }] }
    );
  }

  const body = parseJsonBody(event);
  if (body === null) {
    logger.warn({ event: 'ingest_webhook_invalid_json', partnerId });
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] }
    );
  }

  const validation = webhookPayloadSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({
      event: 'ingest_webhook_validation_error',
      partnerId,
      errors: validation.error.issues,
    });
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      responseOpts(event, requestId),
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      }
    );
  }

  try {
    const result = await ingestWebhook(partnerId, validation.data as Record<string, unknown>, event, logger);
    return ApiResponse.ok(
      { acknowledged: result.acknowledged, eventId: result.eventId },
      'WEBHOOK.INGEST_SUCCESS',
      responseOpts(event, requestId)
    );
  } catch (err) {
    if (err instanceof InvalidSignatureError) {
      return ApiResponse.unauthorized(
        'WEBHOOK.INVALID_SIGNATURE',
        responseOpts(event, requestId),
        { code: 'INVALID_SIGNATURE', details: [{ message: 'Invalid webhook signature' }] }
      );
    }
    if (err instanceof UnknownPartnerError) {
      return ApiResponse.notFound(
        'WEBHOOK.UNKNOWN_PARTNER',
        responseOpts(event, requestId),
        { code: 'UNKNOWN_PARTNER', details: [{ message: 'Partner not found' }] }
      );
    }
    if (err instanceof DuplicateEventError) {
      return ApiResponse.conflict(
        'WEBHOOK.DUPLICATE_EVENT',
        responseOpts(event, requestId),
        { code: 'DUPLICATE_EVENT', details: [{ message: 'Event already processed' }] }
      );
    }
    if (err instanceof InvalidPayloadError) {
      return ApiResponse.unprocessableEntity(
        'COMMON.VALIDATION_ERROR',
        responseOpts(event, requestId),
        { code: 'INVALID_PAYLOAD', details: [{ message: err.message }] }
      );
    }
    logger.error({ event: 'ingest_webhook_error', partnerId, err: serializeError(err) });
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
}

export function reportHttpLog(
  logger: Logger,
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
  requestId: string
): void {
  logHttpRequest(logger, method, path, statusCode, durationMs, requestId);
}
