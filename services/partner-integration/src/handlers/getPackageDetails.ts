import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { getRequestId, responseOpts, createHandlerLogger } from '../utils/handlerHelpers';
import { ApiResponse } from '@api-hub/utils';

/**
 * Get package details by code.
 * Phase 2: Implement when adapters expose getPackageDetails.
 */
export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const requestId = getRequestId(event, context);
  const partnerId = event.queryStringParameters?.partnerId;
  const code = event.queryStringParameters?.code;
  const logger = createHandlerLogger(event, context);

  if (!partnerId || !code) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'partnerId and code query parameters are required' }] }
    );
  }

  logger.info({ event: 'getPackageDetails_received', partnerId });
  return ApiResponse.ok(
    { message: 'Not implemented', partnerId, code },
    'PARTNER_INTEGRATION.PLACEHOLDER',
    responseOpts(event, requestId)
  );
};
