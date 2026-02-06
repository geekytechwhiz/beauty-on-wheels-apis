import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { cancelOrderPathSchema, cancelOrderBodySchema } from '../validation/cancelOrder.schema';
import {
  getRequestId,
  responseOpts,
  createHandlerLogger,
  parseJsonBody,
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
  logger.info({ event: 'cancelLabOrder_received', orderId });

  const pathValidation = cancelOrderPathSchema.safeParse({ orderId });
  if (!pathValidation.success || !orderId) {
    logger.warn({ event: 'cancelLabOrder_invalid_path', errors: pathValidation.error?.issues });
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Missing or invalid orderId in path' }] }
    );
  }

  const body = parseJsonBody(event);
  if (body === null) {
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] }
    );
  }
  const bodyValidation = cancelOrderBodySchema.safeParse(body);
  if (!bodyValidation.success) {
    logger.warn({ event: 'cancelLabOrder_validation_error', errors: bodyValidation.error.issues });
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      responseOpts(event, requestId),
      {
        code: 'VALIDATION_ERROR',
        details: bodyValidation.error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      }
    );
  }

  const { partnerId } = bodyValidation.data;

  try {
    const result = await labIntegrationService.cancelLabOrder(partnerId, orderId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/lab/orders/cancel', 200, duration, requestId);
    return ApiResponse.ok(result, 'LAB_INTEGRATION.ORDER_CANCELLED', responseOpts(event, requestId));
  } catch (err) {
    logger.error({ event: 'cancelLabOrder_error', err: serializeError(err), partnerId, orderId });
    const duration = Date.now() - startTime;
    if (err instanceof UnsupportedPartnerError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/lab/orders/cancel', 400, duration, requestId);
      return ApiResponse.badRequest(
        'LAB_INTEGRATION.UNSUPPORTED_PARTNER',
        responseOpts(event, requestId),
        { code: 'UNSUPPORTED_PARTNER', details: [{ message: err.message }] }
      );
    }
    if (err instanceof PartnerUnavailableError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/lab/orders/cancel', 503, duration, requestId);
      return ApiResponse.error(
        503,
        'LAB_INTEGRATION.PARTNER_UNAVAILABLE',
        responseOpts(event, requestId),
        { code: 'PARTNER_UNAVAILABLE', details: [{ message: err.message }] }
      );
    }
    if (err instanceof InvalidPartnerResponseError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/lab/orders/cancel', 502, duration, requestId);
      return ApiResponse.error(
        502,
        'LAB_INTEGRATION.INVALID_PARTNER_RESPONSE',
        responseOpts(event, requestId),
        { code: 'INVALID_PARTNER_RESPONSE', details: [{ message: err.message }] }
      );
    }
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/lab/orders/cancel', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
