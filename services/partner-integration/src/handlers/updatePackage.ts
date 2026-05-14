import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import {
  getRequestId,
  responseOpts,
  createHandlerLogger,
  parseJsonBody,
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
  const requestId = getRequestId(event, context);
  const logger = createHandlerLogger(event, context);
  logger.info({ event: 'updatePackage_received' });

  const packageCode = event.pathParameters?.packageCode;
  const partnerId = event.queryStringParameters?.partnerId;
  const idempotencyKey = event.headers['Idempotency-Key'] || event.headers['idempotency-key'];

  if (!packageCode) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId ),
      { code: 'BAD_REQUEST', details: [{ message: 'packageCode path parameter is required' }] }
    );
  }

  if (!partnerId) {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'partnerId query parameter is required' }] }
    );
  }

  const body = parseJsonBody(event);
  if (body === null || typeof body !== 'object') {
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Request body is required' }] }
    );
  }

  const updateData = body as Record<string, unknown>;

  logger.info({ event: 'updatePackage_processing', partnerId, packageCode, correlationId: requestId });

  try {
    const result = await integrationService.updatePackage(partnerId, packageCode, updateData, idempotencyKey);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/packages', 200, duration, requestId);
    return ApiResponse.ok(result, 'PARTNER_INTEGRATION.PACKAGE_UPDATED', responseOpts(event, requestId));
  } catch (err) {
    logger.error({ event: 'updatePackage_error', err: serializeError(err), partnerId });
    const duration = Date.now() - startTime;

    if (err instanceof UnsupportedPartnerError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/packages', 400, duration, requestId);
      return ApiResponse.badRequest(
        'PARTNER_INTEGRATION.UNSUPPORTED_PARTNER',
        responseOpts(event, requestId),
        { code: 'UNSUPPORTED_PARTNER', details: [{ message: err.message }] }
      );
    }
    if (err instanceof ServicePartnerUnavailableError || err instanceof PartnerUnavailableError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/packages', 503, duration, requestId);
      return ApiResponse.error(
        503,
        { code: 'PARTNER_UNAVAILABLE', details: [{ message: 'PARTNER_INTEGRATION.PARTNER_UNAVAILABLE' }] },
        responseOpts(event, requestId),
        { code: 'PARTNER_UNAVAILABLE', details: [{ message: err.message }] }
      );
    }
    if (err instanceof InvalidPartnerResponseError || err instanceof ServiceInvalidPartnerResponseError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/packages', 502, duration, requestId);
      return ApiResponse.error(
        502,
        { message: 'PARTNER_INTEGRATION.INVALID_PARTNER_RESPONSE' },
        responseOpts(event, requestId),
        { code: 'INVALID_PARTNER_RESPONSE', details: [{ message: err.message }] }
      );
    }
    if (err instanceof PartnerAuthenticationError) {
      return ApiResponse.badRequest(
        { message: 'PARTNER_INTEGRATION.AUTH_FAILED' },
        responseOpts(event, requestId),
        { code: 'AUTH_FAILED', details: [{ message: err.message }] }
      );
    }
    if (err instanceof PartnerNotFoundError) {
      return ApiResponse.badRequest(
        { message: 'PARTNER_INTEGRATION.NOT_FOUND' },
        responseOpts(event, requestId),
        { code: 'NOT_FOUND', details: [{ message: err.message }] }
      );
    }
    if (err instanceof Error && err.message?.includes('not supported')) {
      return ApiResponse.badRequest(
        { message: 'PARTNER_INTEGRATION.UNSUPPORTED_OPERATION' },
        responseOpts(event, requestId),
        { code: 'UNSUPPORTED_OPERATION', details: [{ message: err.message }] }
      );
    }

    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/packages', 500, duration, requestId);
    return ApiResponse.internalServerError(
      { message: 'COMMON.INTERNAL_ERROR' },
      responseOpts(event, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
