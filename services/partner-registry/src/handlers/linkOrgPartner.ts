import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { linkOrgPartnerSchema } from '../validation/orgPartner.schema';
import { PartnerNotFoundError, OrgPartnerLinkExistsError } from '../utils/errors';
import {
  getRequestId,
  responseOpts,
  createHandlerLogger,
  parseJsonBody,
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

  const body = parseJsonBody(event);
  if (body === null) {
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      responseOpts(event, requestId),
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] }
    );
  }

  const validation = linkOrgPartnerSchema.safeParse(body);
  if (!validation.success) {
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      responseOpts(event, requestId),
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
      responseOpts(event, requestId)
    );
  } catch (err) {
    if (err instanceof PartnerNotFoundError) {
      return ApiResponse.notFound(
        'PARTNER.PARTNER_NOT_FOUND',
        responseOpts(event, requestId),
        { code: 'PARTNER_NOT_FOUND', details: [{ message: err.message }] }
      );
    }
    if (err instanceof OrgPartnerLinkExistsError) {
      return ApiResponse.conflict(
        'PARTNER.ORG_PARTNER_LINK_EXISTS',
        responseOpts(event, requestId),
        { code: 'ORG_PARTNER_LINK_EXISTS', details: [{ message: err.message }] }
      );
    }
    logger.error({ event: 'linkOrgPartner_error', err: serializeError(err) });
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      responseOpts(event, requestId),
      { code: 'INTERNAL_ERROR' }
    );
  }
};
