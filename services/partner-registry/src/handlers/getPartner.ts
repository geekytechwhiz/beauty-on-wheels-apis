import { logHttpRequest, serializeError } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import type { Context } from 'aws-lambda';
import {
  createHandlerLogger,
  getPartnerService,
  getRequestId
} from '../utils/handlerHelpers';

export const main: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const partnerId = event.pathParameters?.id;
  const logger = createHandlerLogger(event, context, { partnerId });
  logger.info({ event: 'getPartner_received', partnerId });

  if (!partnerId) {
    logger.warn({ event: 'getPartner_missing_id' });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/partner', 400, duration, requestId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { correlationId: requestId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Missing partner id in path' }] }
    );
  }

  try {
    const partner = await getPartnerService().getPartner(partnerId);
    if (!partner) {
      logger.warn({ event: 'getPartner_not_found', partnerId });
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/partner', 404, duration, requestId);
      return ApiResponse.notFound(
        'PARTNER.PARTNER_NOT_FOUND',
        { correlationId: requestId, event },
        { code: 'PARTNER_NOT_FOUND', details: [{ message: `Partner ${partnerId} not found` }] }
      );
    }
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/partner', 200, duration, requestId);
    return ApiResponse.ok(partner, 'PARTNER.PARTNER_RETRIEVED_SUCCESS', { correlationId: requestId, event });
  } catch (err) {
    logger.error({ event: 'getPartner_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/partner', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      { correlationId: requestId, event },
      { code: 'INTERNAL_ERROR' }
    );
  }
};
