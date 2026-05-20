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
import { approvePartnerBodySchema } from '../validation/approveReject.schema';

export const main: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const partnerId = event.pathParameters?.id;
  const logger = createHandlerLogger(event, context, { partnerId });
  logger.info({ event: 'approvePartner_received', partnerId });

  if (!partnerId) {
    logger.warn({ event: 'approvePartner_missing_id' });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/partner/approve', 400, duration, requestId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { correlationId: requestId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Missing partner id in path' }] }
    );
  }

  const body = parseJsonBody(event);
  const parsed = body && typeof body === 'object' && body !== null ? approvePartnerBodySchema.safeParse(body) : null;
  const approvedBy = parsed?.success ? parsed.data?.approvedBy : undefined;

  try {
    const partner = await getPartnerService().approvePartner(partnerId, approvedBy);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/partner/approve', 200, duration, requestId);
    return ApiResponse.ok(partner, 'PARTNER.PARTNER_APPROVED_SUCCESS', { correlationId: requestId, event });
  } catch (err) {
    if (err instanceof PartnerNotFoundError) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/partner/approve', 404, duration, requestId);
      return ApiResponse.notFound(
        'PARTNER.PARTNER_NOT_FOUND',
        { correlationId: requestId, event },
        { code: 'PARTNER_NOT_FOUND', details: [{ message: err.message }] }
      );
    }
    if (err instanceof PartnerInvalidStatusTransitionError) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/partner/approve', 409, duration, requestId);
      return ApiResponse.conflict(
        { title: 'PARTNER.INVALID_STATUS_TRANSITION', description: 'PARTNER.INVALID_STATUS_TRANSITION', severity: 'ERROR' },
        { correlationId: requestId, event },
        { code: 'INVALID_STATUS_TRANSITION', details: [{ message: err.message }] }
      );
    }
    logger.error({ event: 'approvePartner_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/partner/approve', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
          { correlationId: requestId, event },
      { code: 'INTERNAL_ERROR' }
    );
  }
};
