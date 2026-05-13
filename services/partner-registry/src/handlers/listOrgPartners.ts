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
  const orgId = event.pathParameters?.orgId;
  const logger = createHandlerLogger(event: any, context, { organizationId: orgId });
  logger.info({ event: 'listOrgPartners_received', organizationId: orgId });

  if (!orgId) {
    logger.warn({ event: 'listOrgPartners_missing_org_id' });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/organization/partners', 400, duration, requestId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event: any, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Missing organization id in path' }] }
    );
  }

  try {
    const partners = await getPartnerService().listPartnersForOrgFull(orgId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/organization/partners', 200, duration, requestId);
    return ApiResponse.ok(
      { items: partners },
      'PARTNER.PARTNERS_LIST_SUCCESS',
      responseOpts(event: any, requestId)
    );
  } catch (err) {
    logger.error({ event: 'listOrgPartners_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/organization/partners', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event: any, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
