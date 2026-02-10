import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { getRequestId, responseOpts, createHandlerLogger } from '../utils/handlerHelpers';
import { ApiResponse } from '@api-hub/utils';

/**
 * Get serviceable locations for a partner.
 * Phase 2: Implement when adapters expose getServiceableLocations.
 */
export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const requestId = getRequestId(event, context);
  const partnerId = event.queryStringParameters?.partnerId;
  const query = event.queryStringParameters?.query;
  const logger = createHandlerLogger(event, context);

  if (!partnerId) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'partnerId query parameter is required' }] }
    );
  }

  logger.info({ event: 'getServiceableLocations_received', partnerId });
  return ApiResponse.ok(
    { message: 'Not implemented', partnerId, query: query ?? '' },
    'PARTNER_INTEGRATION.PLACEHOLDER',
    responseOpts(event, requestId)
  );
};
