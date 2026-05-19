import { logHttpRequest, serializeError } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import type { Context } from 'aws-lambda';
import { PartnerInvalidStatusTransitionError, PartnerNotFoundError } from '../utils/errors';
import {
  createHandlerLogger,
  getPartnerService,
  getRequestId,
  parseJsonBody
} from '../utils/handlerHelpers';
import { rejectPartnerBodySchema } from '../validation/approveReject.schema';

export const main: any = async (event: any, context?: Context) => {
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
      { correlationId: requestId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Missing partner id in path' }] }
    );
  }

  const body = parseJsonBody(event);
  if (body === null) {
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { correlationId: requestId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] }
    );
  }
  const validation = rejectPartnerBodySchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'rejectPartner_validation_error', errors: validation.error.issues });
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

  try {
    const partner = await getPartnerService().rejectPartner(partnerId, validation.data.rejectionReason);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/partner/reject', 200, duration, requestId);
    return ApiResponse.ok(partner, 'PARTNER.PARTNER_REJECTED_SUCCESS', { correlationId: requestId, event });
  } catch (err) {
    if (err instanceof PartnerNotFoundError) {
      return ApiResponse.notFound(
        'PARTNER.PARTNER_NOT_FOUND',
        { correlationId: requestId, event },
        { code: 'PARTNER_NOT_FOUND', details: [{ message: err.message }] }
      );
    }
    if (err instanceof PartnerInvalidStatusTransitionError) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/partner/reject', 409, duration, requestId);
      return ApiResponse.conflict(
        { title: 'PARTNER.INVALID_STATUS_TRANSITION', description: 'PARTNER.INVALID_STATUS_TRANSITION', severity: 'ERROR' },
        { correlationId: requestId, event },
        { code: 'INVALID_STATUS_TRANSITION', details: [{ message: err.message }] }
      );
    }
    logger.error({ event: 'rejectPartner_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/partner/reject', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      { correlationId: requestId, event },
      { code: 'INTERNAL_ERROR' }
    );
  }
};
