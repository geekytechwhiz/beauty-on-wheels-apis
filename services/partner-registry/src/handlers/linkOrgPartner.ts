import { logHttpRequest, serializeError } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import type { Context } from 'aws-lambda';
import { OrgPartnerLinkExistsError, PartnerNotFoundError } from '../utils/errors';
import {
  createHandlerLogger,
  getPartnerService,
  getRequestId,
  parseJsonBody
} from '../utils/handlerHelpers';
import { linkOrgPartnerSchema } from '../validation/orgPartner.schema';

export const main: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const orgId = event.pathParameters?.orgId;
  const logger = createHandlerLogger(event, context, { organizationId: orgId });
  logger.info({ event: 'linkOrgPartner_received', organizationId: orgId });

  if (!orgId) {
    logger.warn({ event: 'linkOrgPartner_missing_org_id' });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization/partner', 400, duration, requestId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { correlationId: requestId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Missing organization id in path' }] }
    );
  }

  const body = parseJsonBody(event);
  if (body === null) {
    logger.warn({ event: 'linkOrgPartner_invalid_json' });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization/partner', 400, duration, requestId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { correlationId: requestId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] }
    );
  }

  const validation = linkOrgPartnerSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'linkOrgPartner_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization/partner', 422, duration, requestId);
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
    await getPartnerService().linkOrgPartner(
      orgId,
      validation.data.partnerId,
      validation.data.relationshipType
    );
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization/partner', 201, duration, requestId);
    return ApiResponse.created(
      { organizationId: orgId, partnerId: validation.data.partnerId },
      'PARTNER.ORG_PARTNER_LINKED_SUCCESS',
      { correlationId: requestId, event },
    );
  } catch (err) {
    if (err instanceof PartnerNotFoundError) {
      logger.warn({ event: 'linkOrgPartner_partner_not_found', err: serializeError(err) });
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization/partner', 404, duration, requestId);
      return ApiResponse.notFound(
        'PARTNER.PARTNER_NOT_FOUND',
        { correlationId: requestId, event },
        { code: 'PARTNER_NOT_FOUND', details: [{ message: err.message }] }
      );
    }
    if (err instanceof OrgPartnerLinkExistsError) {
      logger.warn({ event: 'linkOrgPartner_link_exists', err: serializeError(err) });
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization/partner', 409, duration, requestId);
      return ApiResponse.conflict(
        { title: 'PARTNER.ORG_PARTNER_LINK_EXISTS', description: 'PARTNER.ORG_PARTNER_LINK_EXISTS', severity: 'ERROR' },
        { correlationId: requestId, event },
        { code: 'ORG_PARTNER_LINK_EXISTS', details: [{ message: err.message }] }
      );
    }
    logger.error({ event: 'linkOrgPartner_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization/partner', 500, duration, requestId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      { correlationId: requestId, event },
      { code: 'INTERNAL_ERROR' }
    );
  }
};
