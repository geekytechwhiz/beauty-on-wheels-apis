import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import type { UpdatePartnerInput } from '../models/partner.model';
import { updatePartnerSchema } from '../validation/updatePartner.schema';
import {
  getRequestId,
  responseOpts,
  createHandlerLogger,
  parseJsonBody,
  getPartnerService,
} from '../utils/handlerHelpers';

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const partnerId = event.pathParameters?.id;
  const logger = createHandlerLogger(event, context, { partnerId });
  logger.info({ event: 'updatePartner_received', partnerId });

  if (!partnerId) {
    logger.warn({ event: 'updatePartner_missing_id' });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PATCH', event.path || '/partner', 400, duration, requestId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Missing partner id in path' }] }
    );
  }

  const body = parseJsonBody(event);
  if (body === null) {
    logger.warn({ event: 'updatePartner_invalid_json' });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PATCH', event.path || '/partner', 400, duration, requestId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] }
    );
  }

  const validation = updatePartnerSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'updatePartner_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PATCH', event.path || '/partner', 422, duration, requestId);
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

  try {
    const partner = await getPartnerService().updatePartner(partnerId, validation.data as UpdatePartnerInput);
    if (!partner) {
      logger.warn({ event: 'updatePartner_not_found', partnerId });
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'PATCH', event.path || '/partner', 404, duration, requestId);
      return ApiResponse.notFound(
        'PARTNER.PARTNER_NOT_FOUND',
        responseOpts(event, requestId),
        { code: 'PARTNER_NOT_FOUND', details: [{ message: `Partner ${partnerId} not found` }] }
      );
    }
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PATCH', event.path || '/partner', 200, duration, requestId);
    return ApiResponse.ok(partner, 'PARTNER.PARTNER_UPDATED_SUCCESS', responseOpts(event, requestId));
  } catch (err) {
    logger.error({ event: 'updatePartner_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PATCH', event.path || '/partner', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
