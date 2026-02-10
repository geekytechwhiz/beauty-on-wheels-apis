import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { getRequestId, responseOpts, createHandlerLogger } from '../utils/handlerHelpers';
import { ApiResponse } from '@api-hub/utils';

/**
 * Get partner location by eloc.
 * Phase 2: Implement when adapters expose getPartnerLocation.
 */
export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const requestId = getRequestId(event, context);
  const partnerId = event.queryStringParameters?.partnerId;
  const eloc = event.queryStringParameters?.eloc;
  const logger = createHandlerLogger(event, context);

  if (!partnerId || !eloc) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'partnerId and eloc query parameters are required' }] }
    );
  }

  logger.info({ event: 'getPartnerLocation_received', partnerId });
  return ApiResponse.ok(
    { message: 'Not implemented', partnerId, eloc },
    'PARTNER_INTEGRATION.PLACEHOLDER',
    responseOpts(event, requestId)
  );
};
