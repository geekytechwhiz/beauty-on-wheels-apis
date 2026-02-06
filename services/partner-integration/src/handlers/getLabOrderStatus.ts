import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { statusPathSchema, statusQuerySchema } from '../validation/status.schema';
import {
  getRequestId,
  responseOpts,
  createHandlerLogger,
} from '../utils/handlerHelpers';
import * as labIntegrationService from '../services/labIntegration.service';
import {
  PartnerUnavailableError,
  UnsupportedPartnerError,
  InvalidPartnerResponseError,
} from '../utils/integrationErrors';

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const orderId = event.pathParameters?.orderId;
  const logger = createHandlerLogger(event, context, { orderId });
  logger.info({ event: 'getLabOrderStatus_received', orderId });

  const pathValidation = statusPathSchema.safeParse({ orderId });
  if (!pathValidation.success || !orderId) {
    logger.warn({ event: 'getLabOrderStatus_invalid_path' });
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Missing or invalid orderId in path' }] }
    );
  }

  const queryParams = event.queryStringParameters ?? {};
  const queryValidation = statusQuerySchema.safeParse(queryParams);
  if (!queryValidation.success) {
    logger.warn({ event: 'getLabOrderStatus_missing_partnerId', errors: queryValidation.error.issues });
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Query parameter partnerId is required' }] }
    );
  }
  const { partnerId } = queryValidation.data;

  try {
    const result = await labIntegrationService.getLabOrderStatus(partnerId, orderId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/lab/orders/status', 200, duration, requestId);
    return ApiResponse.ok(result, 'LAB_INTEGRATION.STATUS_RETRIEVED', responseOpts(event, requestId));
  } catch (err) {
    logger.error({ event: 'getLabOrderStatus_error', err: serializeError(err), partnerId, orderId });
    const duration = Date.now() - startTime;
    if (err instanceof UnsupportedPartnerError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/lab/orders/status', 400, duration, requestId);
      return ApiResponse.badRequest(
        'LAB_INTEGRATION.UNSUPPORTED_PARTNER',
        responseOpts(event, requestId),
        { code: 'UNSUPPORTED_PARTNER', details: [{ message: err.message }] }
      );
    }
    if (err instanceof PartnerUnavailableError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/lab/orders/status', 503, duration, requestId);
      return ApiResponse.error(
        503,
        'LAB_INTEGRATION.PARTNER_UNAVAILABLE',
        responseOpts(event, requestId),
        { code: 'PARTNER_UNAVAILABLE', details: [{ message: err.message }] }
      );
    }
    if (err instanceof InvalidPartnerResponseError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/lab/orders/status', 502, duration, requestId);
      return ApiResponse.error(
        502,
        'LAB_INTEGRATION.INVALID_PARTNER_RESPONSE',
        responseOpts(event, requestId),
        { code: 'INVALID_PARTNER_RESPONSE', details: [{ message: err.message }] }
      );
    }
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/lab/orders/status', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
