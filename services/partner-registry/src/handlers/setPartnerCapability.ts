import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { setCapabilitySchema } from '../validation/capability.schema';
import { PartnerNotFoundError } from '../utils/errors';
import {
  getRequestId,
  responseOpts,
  createHandlerLogger,
  parseJsonBody,
  getPartnerService,
} from '../utils/handlerHelpers';

export const main: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event: any, context);
  const partnerId = event.pathParameters?.id;
  const logger = createHandlerLogger(event: any, context, { partnerId });
  logger.info({ event: 'setPartnerCapability_received', partnerId });

  if (!partnerId) {
    logger.warn({ event: 'setPartnerCapability_missing_id' });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/partner/capability', 400, duration, requestId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      responseOpts(event: any, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Missing partner id in path' }] }
    );
  }

  const body = parseJsonBody(event);
  if (body === null) {
    logger.warn({ event: 'setPartnerCapability_invalid_json' });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/partner/capability', 400, duration, requestId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      responseOpts(event: any, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] }
    );
  }

  const validation = setCapabilitySchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'setPartnerCapability_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/partner/capability', 422, duration, requestId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      responseOpts(event: any, requestId),
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      }
    );
  }

  try {
    const capability = await getPartnerService().setCapability(partnerId, validation.data);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/partner/capability', 200, duration, requestId);
    return ApiResponse.ok(capability, 'PARTNER.CAPABILITY_SET_SUCCESS', responseOpts(event: any, requestId));
  } catch (err) {
    if (err instanceof PartnerNotFoundError) {
      logger.warn({ event: 'setPartnerCapability_partner_not_found', err: serializeError(err) });
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/partner/capability', 404, duration, requestId);
      return ApiResponse.notFound(
        'PARTNER.PARTNER_NOT_FOUND',
        responseOpts(event: any, requestId),
        { code: 'PARTNER_NOT_FOUND', details: [{ message: err.message }] }
      );
    }
    logger.error({ event: 'setPartnerCapability_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/partner/capability', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event: any, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
