import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { getRescheduleOrderSchema } from '@api-hub/lab-integration';
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
  const orderId = event.pathParameters?.orderId;
  const logger = createHandlerLogger(event, context, { orderId });
  logger.info({ event: 'rescheduleOrder_received', orderId });

  if (!orderId) {
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

  const partnerId = (body as { partnerId?: string }).partnerId;
  if (!partnerId) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'partnerId is required' }] }
    );
  }

  const schema = getRescheduleOrderSchema(partnerId);
  const validation = schema.safeParse({ ...(body as object), orderId });
  if (!validation.success) {
    logger.warn({ event: 'rescheduleOrder_validation_error', errors: validation.error.issues });
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

  const idempotencyKey = getIdempotencyKey(event);

  try {
    const result = await integrationService.rescheduleOrder(
      partnerId,
      orderId,
      validation.data as Parameters<typeof integrationService.rescheduleOrder>[2],
      idempotencyKey
    );
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders/reschedule', 200, duration, requestId);
    return ApiResponse.ok(result, 'PARTNER_INTEGRATION.ORDER_RESCHEDULED', responseOpts(event, requestId));
  } catch (err) {
    logger.error({ event: 'rescheduleOrder_error', err: serializeError(err), partnerId, orderId });
    const duration = Date.now() - startTime;

    const handled = await handlePartnerIntegrationError(err, event, requestId);
    if (handled) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders/reschedule', handled.statusCode, duration, requestId);
      return handled;
    }

    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders/reschedule', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
