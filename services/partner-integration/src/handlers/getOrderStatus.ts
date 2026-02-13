import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import {
  getRequestId,
  responseOpts,
  createHandlerLogger,
} from '../utils/handlerHelpers';
import { handlePartnerIntegrationError } from '../utils/partnerErrorHandler';
import * as integrationService from '../services/integration.service';

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const orderId = event.pathParameters?.orderId;
  const partnerId = event.queryStringParameters?.partnerId;
  const logger = createHandlerLogger(event, context, { orderId });
  logger.info({ event: 'getOrderStatus_received', orderId });

  if (!orderId) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Missing or invalid orderId in path' }] }
    );
  }
  if (!partnerId) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Query parameter partnerId is required' }] }
    );
  }

  const bookingDate = event.queryStringParameters?.bookingDate;
  const collectionDate = event.queryStringParameters?.collectionDate;
  const options = (bookingDate || collectionDate) ? { bookingDate, collectionDate } : undefined;

  try {
    const result = await integrationService.getOrderStatus(partnerId, orderId, options);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/orders/status', 200, duration, requestId);
    return ApiResponse.ok(result, 'PARTNER_INTEGRATION.STATUS_RETRIEVED', responseOpts(event, requestId));
  } catch (err) {
    logger.error({ event: 'getOrderStatus_error', err: serializeError(err), partnerId, orderId });
    const duration = Date.now() - startTime;

    const handled = await handlePartnerIntegrationError(err, event, requestId);
    if (handled) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/orders/status', handled.statusCode, duration, requestId);
      return handled;
    }

    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/orders/status', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
