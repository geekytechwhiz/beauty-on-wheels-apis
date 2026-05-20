import { logHttpRequest, serializeError } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import type { Context } from 'aws-lambda';
import { processInboundWebhook } from '../services/webhook.service';
import {
  createHandlerLogger,
  getRequestId,
  parseJsonBody
} from '../utils/handlerHelpers';
import { PartnerUnavailableError } from '../utils/integrationErrors';

export const main: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const logger = createHandlerLogger(event, context);    
  logger.info({ event: 'webhookLabEvent_received' });

  const partnerId = event.pathParameters?.partnerId;
  if (!partnerId) {
    logger.warn({ event: 'webhookLabEvent_missing_partner_id' });
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { correlationId: requestId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'partnerId is required in path' }] }
    );
  }

  // Extract raw body for signature validation (before parsing)
  const rawBody = typeof event.body === 'string' ? event.body : JSON.stringify(event.body || {});

  const body = parseJsonBody(event);
  if (body === null) {
    logger.warn({ event: 'webhookLabEvent_invalid_json' });
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { correlationId: requestId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] }
    );
  }

  // Extract headers (normalize to lowercase keys for consistency)
  const headers: Record<string, string> = {};
  if (event.headers) {
    for (const [key, value] of Object.entries(event.headers)) {
      if (value) {
        headers[key.toLowerCase()] = value as string;
        // Also keep original case for compatibility
        headers[key] = value as string;
      }
    }
  }

  try {
    const result = await processInboundWebhook(partnerId, body, logger, headers, rawBody);
    const duration = Date.now() - startTime;
    if (!result.accepted) {
      const statusCode = result.reason === 'INVALID_SIGNATURE' ? 401 : 422;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/webhooks/labs', statusCode, duration, requestId);
      
      if (result.reason === 'INVALID_SIGNATURE') {
        return ApiResponse.error(
          401,
          'PARTNER_INTEGRATION.WEBHOOK_SIGNATURE_INVALID',
          { correlationId: requestId, event },
          { code: 'WEBHOOK_SIGNATURE_INVALID', details: [{ message: 'Webhook signature validation failed' }] }
        );
      }
      
      return ApiResponse.unprocessableEntity(
        'PARTNER_INTEGRATION.WEBHOOK_NOT_ACCEPTED',
        { correlationId: requestId, event },
        { code: 'WEBHOOK_NOT_ACCEPTED', details: [{ message: 'Webhook payload could not be parsed or mapped to a known event type' }] }
      );
    }
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/webhooks/labs', 200, duration, requestId);
    return ApiResponse.ok(
      { accepted: result.accepted, eventId: result.eventId },
      'PARTNER_INTEGRATION.WEBHOOK_ACCEPTED',
      { correlationId: requestId, event }
    );
  } catch (err) {
    logger.error({ event: 'webhookLabEvent_error', err: serializeError(err), partnerId });
    const duration = Date.now() - startTime;

    if (err instanceof PartnerUnavailableError) {
      const isNotFound = err.message?.toLowerCase().includes('not found');
      const status = isNotFound ? 404 : 503;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/webhooks/labs', status, duration, requestId);
      if (isNotFound) {
        return ApiResponse.notFound(
          'PARTNER_INTEGRATION.PARTNER_NOT_FOUND',
          { correlationId: requestId, event },
          { code: 'PARTNER_NOT_FOUND', details: [{ message: err.message }] }
        );
      }
      return ApiResponse.error(
        503,
        'PARTNER_INTEGRATION.PARTNER_UNAVAILABLE',
        { correlationId: requestId, event },
        { code: 'PARTNER_UNAVAILABLE', details: [{ message: err.message }] }
      );
    }

    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/webhooks/labs', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      { correlationId: requestId, event },
      { code: 'INTERNAL_ERROR' }
    );
  }
};
