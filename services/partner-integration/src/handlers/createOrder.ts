import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { createOrderSchema } from '../validation/createOrder.schema';
import {
  getRequestId,
  responseOpts,
  createHandlerLogger,
  parseJsonBody,
} from '../utils/handlerHelpers';
import * as integrationService from '../services/integration.service';
import {
  PartnerUnavailableError,
  UnsupportedPartnerError,
  InvalidPartnerResponseError,
} from '../utils/integrationErrors';

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const logger = createHandlerLogger(event, context);
  logger.info({ event: 'createOrder_received' });

  const body = parseJsonBody(event);
  if (body === null) {
    logger.warn({ event: 'createOrder_invalid_json' });
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] }
    );
  }

  const validation = createOrderSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'createOrder_validation_error', errors: validation.error.issues });
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

  const { partnerId } = validation.data;
  logger.info({ event: 'createOrder_processing', partnerId, correlationId: requestId });

  try {
    const result = await integrationService.createOrder(validation.data);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders', 201, duration, requestId);
    return ApiResponse.created(result, 'PARTNER_INTEGRATION.ORDER_CREATED', responseOpts(event, requestId));
  } catch (err) {
    logger.error({ event: 'createOrder_error', err: serializeError(err), partnerId });
    const duration = Date.now() - startTime;
    if (err instanceof UnsupportedPartnerError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders', 400, duration, requestId);
      return ApiResponse.badRequest(
        'PARTNER_INTEGRATION.UNSUPPORTED_PARTNER',
        responseOpts(event, requestId),
        { code: 'UNSUPPORTED_PARTNER', details: [{ message: err.message }] }
      );
    }
    if (err instanceof PartnerUnavailableError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders', 503, duration, requestId);
      return ApiResponse.error(
        503,
        'PARTNER_INTEGRATION.PARTNER_UNAVAILABLE',
        responseOpts(event, requestId),
        { code: 'PARTNER_UNAVAILABLE', details: [{ message: err.message }] }
      );
    }
    if (err instanceof InvalidPartnerResponseError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders', 502, duration, requestId);
      return ApiResponse.error(
        502,
        'PARTNER_INTEGRATION.INVALID_PARTNER_RESPONSE',
        responseOpts(event, requestId),
        { code: 'INVALID_PARTNER_RESPONSE', details: [{ message: err.message }] }
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
