import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import {
  getRequestId,
  responseOpts,
  createHandlerLogger,
  parseJsonBody,
  getIdempotencyKey,
} from '../utils/handlerHelpers';
import { handlePartnerIntegrationError } from '../utils/partnerErrorHandler';
import * as integrationService from '../services/integration.service';

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const logger = createHandlerLogger(event, context);
  logger.info({ event: 'confirmBooking_received' });

  const orderId = event.pathParameters?.orderId;
  const partnerId = event.queryStringParameters?.partnerId;
  const idempotencyKey = getIdempotencyKey(event);

  if (!orderId) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'orderId path parameter is required' }] }
    );
  }

  if (!partnerId) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'partnerId query parameter is required' }] }
    );
  }

  const body = parseJsonBody(event);
  const remark = body && typeof body === 'object' && 'remark' in body
    ? (body as { remark?: string }).remark
    : undefined;

  logger.info({ event: 'confirmBooking_processing', partnerId, orderId, correlationId: requestId });

  try {
    const result = await integrationService.confirmBooking(partnerId, orderId, remark, idempotencyKey);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders', 200, duration, requestId);
    return ApiResponse.ok(result, 'PARTNER_INTEGRATION.BOOKING_CONFIRMED', responseOpts(event, requestId));
  } catch (err) {
    logger.error({ event: 'confirmBooking_error', err: serializeError(err), partnerId });
    const duration = Date.now() - startTime;

    const handled = await handlePartnerIntegrationError(err, event, requestId);
    if (handled) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders', handled.statusCode, duration, requestId);
      return handled;
    }

    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
