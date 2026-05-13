import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import {
  getRequestId,
  responseOpts,
  createHandlerLogger,
  getPartnerService,
} from '../utils/handlerHelpers';

export const main: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event: any, context);
  const partnerId = event.pathParameters?.id;
  const logger = createHandlerLogger(event: any, context, { partnerId });
  logger.info({ event: 'getPartner_received', partnerId });

  if (!partnerId) {
    logger.warn({ event: 'getPartner_missing_id' });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/partner', 400, duration, requestId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event: any, requestId),
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
        responseOpts(event: any, requestId),
        { code: 'PARTNER_NOT_FOUND', details: [{ message: `Partner ${partnerId} not found` }] }
      );
    }
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/partner', 200, duration, requestId);
    return ApiResponse.ok(partner, 'PARTNER.PARTNER_RETRIEVED_SUCCESS', responseOpts(event: any, requestId));
  } catch (err) {
    logger.error({ event: 'getPartner_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/partner', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event: any, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
