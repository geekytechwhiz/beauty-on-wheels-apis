import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import {
  getRequestId,
  responseOpts,
  createHandlerLogger,
  getPartnerService,
} from '../utils/handlerHelpers';

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const orgId = event.pathParameters?.orgId;
  const logger = createHandlerLogger(event, context, { organizationId: orgId });

  if (!orgId) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
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
      responseOpts(event, requestId)
    );
  } catch (err) {
    logger.error({ event: 'listOrgPartners_error', err: serializeError(err) });
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
