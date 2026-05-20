import { logHttpRequest, serializeError } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import type { Context } from 'aws-lambda';
import type { CreatePartnerInput } from '../models/partner.model';
import {
  createHandlerLogger,
  getPartnerService,
  getRequestId,
  parseJsonBody
} from '../utils/handlerHelpers';
import { createPartnerSchema } from '../validation/createPartner.schema';

export const main: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const logger = createHandlerLogger(event, context);
  logger.info({ event: 'createPartner_received' });

  const body = parseJsonBody(event);
  if (body === null) {
    logger.warn({ event: 'createPartner_invalid_json' });
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { correlationId: requestId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] }
    );
  }

  const validation = createPartnerSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'createPartner_validation_error', errors: validation.error.issues });
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { correlationId: requestId, event },
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
    const partner = await getPartnerService().createPartner(validation.data as CreatePartnerInput);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/partner', 201, duration, requestId);
    return ApiResponse.created(
      { partnerId: partner.partnerId, partner },
      'PARTNER.PARTNER_CREATED_SUCCESS',
      { correlationId: requestId, event }
    );
  } catch (err) {
    logger.error({ event: 'createPartner_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/partner', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      { correlationId: requestId, event },
      { code: 'INTERNAL_ERROR' }
    );
  }
};
