import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import {
  getRequestId,
  responseOpts,
  createHandlerLogger,
  parseJsonBody,
} from '../utils/handlerHelpers';
import * as integrationService from '../services/integration.service';
import {
  PartnerUnavailableError as ServicePartnerUnavailableError,
  UnsupportedPartnerError,
  InvalidPartnerResponseError as ServiceInvalidPartnerResponseError,
} from '../utils/integrationErrors';
import {
  InvalidPartnerResponseError,
  PartnerUnavailableError,
  PartnerAuthenticationError,
  PartnerNotFoundError,
} from '@api-hub/lab-integration';

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const logger = createHandlerLogger(event, context);
  logger.info({ event: 'confirmBooking_received' });

  const orderId = event.pathParameters?.orderId;
  const partnerId = event.queryStringParameters?.partnerId;
  const idempotencyKey = event.headers['Idempotency-Key'] || event.headers['idempotency-key'];

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

    if (err instanceof UnsupportedPartnerError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders', 400, duration, requestId);
      return ApiResponse.badRequest(
        'PARTNER_INTEGRATION.UNSUPPORTED_PARTNER',
        responseOpts(event, requestId),
        { code: 'UNSUPPORTED_PARTNER', details: [{ message: err.message }] }
      );
    }
    if (err instanceof ServicePartnerUnavailableError || err instanceof PartnerUnavailableError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders', 503, duration, requestId);
      return ApiResponse.error(
        503,
        'PARTNER_INTEGRATION.PARTNER_UNAVAILABLE',
        responseOpts(event, requestId),
        { code: 'PARTNER_UNAVAILABLE', details: [{ message: err.message }] }
      );
    }
    if (err instanceof InvalidPartnerResponseError || err instanceof ServiceInvalidPartnerResponseError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders', 502, duration, requestId);
      return ApiResponse.error(
        502,
        'PARTNER_INTEGRATION.INVALID_PARTNER_RESPONSE',
        responseOpts(event, requestId),
        { code: 'INVALID_PARTNER_RESPONSE', details: [{ message: err.message }] }
      );
    }
    if (err instanceof PartnerAuthenticationError) {
      return ApiResponse.badRequest(
        'PARTNER_INTEGRATION.AUTH_FAILED',
        responseOpts(event, requestId),
        { code: 'AUTH_FAILED', details: [{ message: err.message }] }
      );
    }
    if (err instanceof PartnerNotFoundError) {
      return ApiResponse.badRequest(
        'PARTNER_INTEGRATION.NOT_FOUND',
        responseOpts(event, requestId),
        { code: 'NOT_FOUND', details: [{ message: err.message }] }
      );
    }
    if (err instanceof Error && err.message?.includes('not supported')) {
      return ApiResponse.badRequest(
        'PARTNER_INTEGRATION.UNSUPPORTED_OPERATION',
        responseOpts(event, requestId),
        { code: 'UNSUPPORTED_OPERATION', details: [{ message: err.message }] }
      );
    }

    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
