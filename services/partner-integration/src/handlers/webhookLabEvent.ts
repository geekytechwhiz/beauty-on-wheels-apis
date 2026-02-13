import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import {
  getRequestId,
  responseOpts,
  createHandlerLogger,
  parseJsonBody,
} from '../utils/handlerHelpers';
import { processInboundWebhook } from '../services/webhook.service';
import { PartnerUnavailableError } from '../utils/integrationErrors';

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const logger = createHandlerLogger(event, context);
  logger.info({ event: 'webhookLabEvent_received' });

  const partnerId = event.pathParameters?.partnerId;
  if (!partnerId) {
    logger.warn({ event: 'webhookLabEvent_missing_partner_id' });
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'partnerId is required in path' }] }
    );
  }

  const body = parseJsonBody(event);
  if (body === null) {
    logger.warn({ event: 'webhookLabEvent_invalid_json' });
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] }
    );
  }

  try {
    const result = await processInboundWebhook(partnerId, body, logger);
    const duration = Date.now() - startTime;
    if (!result.accepted) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/webhooks/labs', 422, duration, requestId);
      return ApiResponse.unprocessableEntity(
        'PARTNER_INTEGRATION.WEBHOOK_NOT_ACCEPTED',
        responseOpts(event, requestId),
        { code: 'WEBHOOK_NOT_ACCEPTED', details: [{ message: 'Webhook payload could not be parsed or mapped to a known event type' }] }
      );
    }
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/webhooks/labs', 200, duration, requestId);
    return ApiResponse.ok(
      { accepted: result.accepted, eventId: result.eventId },
      'PARTNER_INTEGRATION.WEBHOOK_ACCEPTED',
      responseOpts(event, requestId)
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
          responseOpts(event, requestId),
          { code: 'PARTNER_NOT_FOUND', details: [{ message: err.message }] }
        );
      }
      return ApiResponse.error(
        503,
        'PARTNER_INTEGRATION.PARTNER_UNAVAILABLE',
        responseOpts(event, requestId),
        { code: 'PARTNER_UNAVAILABLE', details: [{ message: err.message }] }
      );
    }

    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/webhooks/labs', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
