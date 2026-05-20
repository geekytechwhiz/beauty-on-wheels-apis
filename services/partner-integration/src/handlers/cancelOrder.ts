import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { getCancelOrderSchema } from '@api-hub/lab-integration';
import {
  getRequestId,
  responseOpts,
  createHandlerLogger,
  parseJsonBody,
  getIdempotencyKey,
} from '../utils/handlerHelpers';
import { handlePartnerIntegrationError } from '../utils/partnerErrorHandler';
import * as integrationService from '../services/integration.service';

export const main: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const orderId = event.pathParameters?.orderId;
  const logger = createHandlerLogger(event, context, { orderId });
  logger.info({ event: 'cancelOrder_received', orderId });

  if (!orderId) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { correlationId: requestId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Missing or invalid orderId in path' }] }
    );
  }

  const body = parseJsonBody(event);
  const bodyObj = (body !== null && typeof body === 'object' ? body : {}) as {
    partnerId?: string;
    remark?: string;
  };
  const partnerId = bodyObj.partnerId ?? (event.queryStringParameters?.partnerId as string | undefined);
  if (!partnerId) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { correlationId: requestId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'partnerId is required (body or query)' }] }
    );
  }

  const schema = getCancelOrderSchema(partnerId);
  const validation = schema.safeParse({ partnerId, orderId, remark: bodyObj.remark });
  if (!validation.success) {
    logger.warn({ event: 'cancelOrder_validation_error', errors: validation.error.issues });
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { correlationId: requestId, event },
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
    const result = await integrationService.cancelOrder(
      partnerId,
      orderId,
      validation.data.remark,
      idempotencyKey
    );
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders/cancel', 200, duration, requestId);
    return ApiResponse.ok(result, 'PARTNER_INTEGRATION.ORDER_CANCELLED', { correlationId: requestId, event });
  } catch (err) {
    logger.error({ event: 'cancelOrder_error', err: serializeError(err), partnerId, orderId });
    const duration = Date.now() - startTime;

    const handled = await handlePartnerIntegrationError(err, event, requestId);
    if (handled) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders/cancel', handled.statusCode, duration, requestId);
      return handled;
    }

    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders/cancel', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event, requestId),    
      { code: 'INTERNAL_ERROR' }
    );
  }
};
