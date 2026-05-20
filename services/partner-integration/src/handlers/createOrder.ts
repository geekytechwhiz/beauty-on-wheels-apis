import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { getCreateOrderSchema } from '@api-hub/lab-integration';
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
  const logger = createHandlerLogger(event, context);
  logger.info({ event: 'createOrder_received' });

  const body = parseJsonBody(event);
  if (body === null) {
    logger.warn({ event: 'createOrder_invalid_json' });
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { correlationId: requestId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] }
    );
  }

  const partnerId = (body as { partnerId?: string }).partnerId;
  if (!partnerId) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { correlationId: requestId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'partnerId is required' }] }
    );
  }

  const schema = getCreateOrderSchema(partnerId);
  const validation = schema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'createOrder_validation_error', errors: validation.error.issues });
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

  logger.info({ event: 'createOrder_processing', partnerId, correlationId: requestId });

  try {
    const result = await integrationService.createOrder(
      validation.data as Parameters<typeof integrationService.createOrder>[0],
      idempotencyKey
    );
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders', 201, duration, requestId);
    return ApiResponse.created(result, 'PARTNER_INTEGRATION.ORDER_CREATED', { correlationId: requestId, event });
  } catch (err) {
    logger.error({ event: 'createOrder_error', err: serializeError(err), partnerId });
    const duration = Date.now() - startTime;

    const handled = await handlePartnerIntegrationError(err, event, requestId);
    if (handled) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders', handled.statusCode, duration, requestId);
      return handled;
    }

    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/orders', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
        { correlationId: requestId, event },
      { code: 'INTERNAL_ERROR' }
    );
  }
};
