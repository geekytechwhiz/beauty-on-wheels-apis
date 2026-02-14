import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError,
  logHttpRequest,
  createChildLogger,
} from '@api-hub/logger';
import { LinkedOrganizationsNotFoundError } from '../utils/errors';
import { ApiResponse } from '@api-hub/utils';
import { getLinkedOrganizationsSchema } from '../validation/organization.validation';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();

const PATH = '/organization/linked';

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  const logger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });
  logger.info({ event: 'getLinkedOrganizations_received' });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'getLinkedOrganizations_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST' },
    );
  }

  const authorizer = (event.requestContext as { authorizer?: Record<string, unknown> } | undefined)
    ?.authorizer;
  const userIdFromToken =
    (authorizer?.userId as string) ??
    (authorizer?.userID as string) ??
    (authorizer?.claims as Record<string, unknown>)?.sub ??
    (authorizer?.claims as Record<string, unknown>)?.['custom:userID'];

  const rawBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const payload = {
    organizationId: rawBody.organizationId,
    orgType: rawBody.orgType,
    userId: rawBody.userId ?? userIdFromToken,
    preferredOrgId: rawBody.preferredOrgId,
    limit: rawBody.limit,
    nextPaginationKey: rawBody.nextPaginationKey,
  };

  const validationResult = getLinkedOrganizationsSchema.safeParse(payload);
  if (!validationResult.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validationResult.error.issues.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      },
    );
  }

  const { organizationId, orgType, preferredOrgId, limit, nextPaginationKey } = validationResult.data;
  const limitNum =
    limit !== undefined && Number.isFinite(Number(limit)) ? Number(limit) : undefined;

  try {
    const result = await organizationService.getLinkedOrganizations(
      organizationId,
      { orgType, preferredOrgId, limit: limitNum, nextPaginationKey },
      correlationId,
    );
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 200, duration, correlationId);
    return ApiResponse.ok(
      {
        items: result.items,
        nextPaginationKey: result.nextPaginationKey ?? undefined,
      },
      'FACILITY.LINKED_ORGS_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    // if (err instanceof LinkedOrganizationsNotFoundError) {
    //   logHttpRequest(logger, event.httpMethod || 'POST', PATH, 404, duration, correlationId);
    //   return ApiResponse.badRequest(
    //     'FACILITY.LINKED_ORGANIZATION_NOT_FOUND',
    //     { requestId: correlationId, event },
    //     { code: 'LINKED_ORGANIZATION_NOT_FOUND' },
    //   );
    // }
    logger.error({ event: 'getLinkedOrganizations_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_SERVER_ERROR',
      { requestId: correlationId, event },
      { code: 'INTERNAL_SERVER_ERROR' },
    );
  }
};
