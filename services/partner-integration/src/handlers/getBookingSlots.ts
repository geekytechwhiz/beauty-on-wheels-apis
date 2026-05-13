import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import {
  getRequestId,
  responseOpts,
  createHandlerLogger,
} from '../utils/handlerHelpers';
import * as integrationService from '../services/integration.service';
import {
  PartnerUnavailableError as ServicePartnerUnavailableError,
  UnsupportedPartnerError,
  InvalidPartnerResponseError as ServiceInvalidPartnerResponseError,
} from '../utils/integrationErrors';
import {
  InvalidPartnerResponseError,
  PartnerUnavailableError,
  PartnerAuthenticationError,
  PartnerNotFoundError,
} from '@api-hub/lab-integration';

export const main: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event: any, context);
  const logger = createHandlerLogger(event: any, context);
  logger.info({ event: 'getBookingSlots_received' });

  const partnerId = event.queryStringParameters?.partnerId;
  const latitude = event.queryStringParameters?.latitude;
  const longitude = event.queryStringParameters?.longitude;
  const collectionDate = event.queryStringParameters?.collectionDate;

  if (!partnerId) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event: any, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'partnerId query parameter is required' }] }
    );
  }

  if (!latitude || !longitude || !collectionDate) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event: any, requestId),
      {
        code: 'BAD_REQUEST',
        details: [{ message: 'latitude, longitude and collectionDate query parameters are required' }],
      }
    );
  }

  const latNum = parseFloat(latitude);
  const lonNum = parseFloat(longitude);

  if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event: any, requestId),
      {
        code: 'BAD_REQUEST',
        details: [{ message: 'latitude and longitude must be valid numbers' }],
      }
    );
  }

  logger.info({ event: 'getBookingSlots_processing', partnerId, latitude: latNum, longitude: lonNum, collectionDate, correlationId: requestId });

  try {
    const result = await integrationService.getBookingSlots(partnerId, {
      latitude: latNum,
      longitude: lonNum,
      collectionDate,
    });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/slots', 200, duration, requestId);
    return ApiResponse.ok(result, 'PARTNER_INTEGRATION.SLOTS_RETRIEVED', responseOpts(event: any, requestId));
  } catch (err) {
    logger.error({ event: 'getBookingSlots_error', err: serializeError(err), partnerId });
    const duration = Date.now() - startTime;

    if (err instanceof UnsupportedPartnerError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/slots', 400, duration, requestId);
      return ApiResponse.badRequest(
        'PARTNER_INTEGRATION.UNSUPPORTED_PARTNER',
        responseOpts(event: any, requestId),
        { code: 'UNSUPPORTED_PARTNER', details: [{ message: err.message }] }
      );
    }
    if (err instanceof ServicePartnerUnavailableError || err instanceof PartnerUnavailableError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/slots', 503, duration, requestId);
      return ApiResponse.error(
        503,
        'PARTNER_INTEGRATION.PARTNER_UNAVAILABLE',
        responseOpts(event: any, requestId),
        { code: 'PARTNER_UNAVAILABLE', details: [{ message: err.message }] }
      );
    }
    if (err instanceof InvalidPartnerResponseError || err instanceof ServiceInvalidPartnerResponseError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/slots', 502, duration, requestId);
      return ApiResponse.error(
        502,
        'PARTNER_INTEGRATION.INVALID_PARTNER_RESPONSE',
        responseOpts(event: any, requestId),
        { code: 'INVALID_PARTNER_RESPONSE', details: [{ message: err.message }] }
      );
    }
    if (err instanceof PartnerAuthenticationError) {
      return ApiResponse.badRequest(
        'PARTNER_INTEGRATION.AUTH_FAILED',
        responseOpts(event: any, requestId),
        { code: 'AUTH_FAILED', details: [{ message: err.message }] }
      );
    }
    if (err instanceof PartnerNotFoundError) {
      return ApiResponse.badRequest(
        'PARTNER_INTEGRATION.NOT_FOUND',
        responseOpts(event: any, requestId),
        { code: 'NOT_FOUND', details: [{ message: err.message }] }
      );
    }
    if (err instanceof Error && err.message?.includes('not supported')) {
      return ApiResponse.badRequest(
        'PARTNER_INTEGRATION.UNSUPPORTED_OPERATION',
        responseOpts(event: any, requestId),
        { code: 'UNSUPPORTED_OPERATION', details: [{ message: err.message }] }
      );
    }

    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/slots', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event: any, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
