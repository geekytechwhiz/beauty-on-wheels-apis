import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { getRequestId, responseOpts, createHandlerLogger } from '../utils/handlerHelpers';
import { ApiResponse } from '@api-hub/utils';

/**
 * Get booking slots for a partner.
 * Phase 2: Implement when adapters expose getBookingSlots.
 */
export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const requestId = getRequestId(event, context);
  const partnerId = event.queryStringParameters?.partnerId;
  const latitude = event.queryStringParameters?.latitude;
  const longitude = event.queryStringParameters?.longitude;
  const collectionDate = event.queryStringParameters?.collectionDate;
  const logger = createHandlerLogger(event, context);

  if (!partnerId || !latitude || !longitude || !collectionDate) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      {
        code: 'BAD_REQUEST',
        details: [{ message: 'partnerId, latitude, longitude and collectionDate query parameters are required' }],
      }
    );
  }

  logger.info({ event: 'getBookingSlots_received', partnerId });
  return ApiResponse.ok(
    { message: 'Not implemented', partnerId, latitude, longitude, collectionDate },
    'PARTNER_INTEGRATION.PLACEHOLDER',
    responseOpts(event, requestId)
  );
};
