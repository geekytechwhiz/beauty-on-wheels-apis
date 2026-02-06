import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { rejectPartnerBodySchema } from '../validation/approveReject.schema';
import { PartnerNotFoundError, PartnerInvalidStatusTransitionError } from '../utils/errors';
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
  logger.info({ event: 'rejectPartner_received', partnerId });

  if (!partnerId) {
    logger.warn({ event: 'rejectPartner_missing_id' });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/partner/reject', 400, duration, requestId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Missing partner id in path' }] }
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
  const validation = rejectPartnerBodySchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'rejectPartner_validation_error', errors: validation.error.issues });
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
    const partner = await getPartnerService().rejectPartner(partnerId, validation.data.rejectionReason);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/partner/reject', 200, duration, requestId);
    return ApiResponse.ok(partner, 'PARTNER.PARTNER_REJECTED_SUCCESS', responseOpts(event, requestId));
  } catch (err) {
    if (err instanceof PartnerNotFoundError) {
      return ApiResponse.notFound(
        'PARTNER.PARTNER_NOT_FOUND',
        responseOpts(event, requestId),
        { code: 'PARTNER_NOT_FOUND', details: [{ message: err.message }] }
      );
    }
    if (err instanceof PartnerInvalidStatusTransitionError) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/partner/reject', 409, duration, requestId);
      return ApiResponse.conflict(
        'PARTNER.INVALID_STATUS_TRANSITION',
        responseOpts(event, requestId),
        { code: 'INVALID_STATUS_TRANSITION', details: [{ message: err.message }] }
      );
    }
    logger.error({ event: 'rejectPartner_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/partner/reject', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
