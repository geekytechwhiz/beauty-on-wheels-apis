import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
  APIGatewayProxyHandler,
} from 'aws-lambda';
import {
  createLogger,
  createChildLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError,
  logHttpRequest,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { UserService } from '../services/user.service';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

export async function listOrganizationUsers(
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const organizationId = event.pathParameters?.organizationId;

  if (!organizationId) {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      ...(awsRequestId && { awsRequestId }),
    });
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || `/organization/${organizationId}/users`,
      400,
      duration,
      correlationId,
    );
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      {
        code: 'BAD_REQUEST',
        details: [{ message: 'organizationId is required' }],
      },
    );
  }

  const logger = createChildLogger(baseLogger, {
    correlationId,
    organizationId,
    ...(awsRequestId && { awsRequestId }),
  });
  logger.info({ event: 'listOrganizationUsers_received', eventData: event });

  const qp = event.queryStringParameters || {};

  const rawLimit = qp.limit ?? qp.pageSize;
  const rawOffset = qp.offset ?? qp.page ?? qp.pageIndex;
  const rawStatus = qp.status;
  const rawUserType = qp.userType;
  const rawSpecialty = qp.specialty;
  const rawSearch = qp.search ?? qp.q;
  const rawSortBy = qp.sortBy;
  const rawSortOrder = qp.sortOrder ?? qp.order;

  let limit: number | undefined;
  let offset = 0;
  let sortBy:
    | 'createdDate'
    | 'fullName'
    | 'firstName'
    | 'lastName'
    | 'emailAddress'
    | undefined;
  let sortOrder: 'asc' | 'desc' | undefined;

  const MAX_LIMIT = 100;

  const parseNumber = (value?: string | null): number | undefined => {
    if (!value) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };

  if (rawLimit !== undefined) {
    const parsed = parseNumber(rawLimit);
    if (!parsed || parsed <= 0) {
      const duration = Date.now() - startTime;
      logHttpRequest(
        logger,
        event.httpMethod || 'GET',
        event.path || `/organization/${organizationId}/users`,
        400,
        duration,
        correlationId,
      );
      return ApiResponse.badRequest(
        'COMMON.BAD_REQUEST',
        { requestId: correlationId, event },
        {
          code: 'BAD_REQUEST',
          details: [{ message: 'limit must be a positive number' }],
        },
      );
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  if (rawOffset !== undefined) {
    const parsed = parseNumber(rawOffset);
    if (parsed === undefined || parsed < 0) {
      const duration = Date.now() - startTime;
      logHttpRequest(
        logger,
        event.httpMethod || 'GET',
        event.path || `/organization/${organizationId}/users`,
        400,
        duration,
        correlationId,
      );
      return ApiResponse.badRequest(
        'COMMON.BAD_REQUEST',
        { requestId: correlationId, event },
        {
          code: 'BAD_REQUEST',
          details: [
            {
              message:
                'offset / page must be a non-negative number',
            },
          ],
        },
      );
    }
    offset = parsed;
  }

  if (rawSortBy) {
    const allowedSortBy = [
      'createdDate',
      'fullName',
      'firstName',
      'lastName',
      'emailAddress',
    ] as const;
    if (!allowedSortBy.includes(rawSortBy as any)) {
      const duration = Date.now() - startTime;
      logHttpRequest(
        logger,
        event.httpMethod || 'GET',
        event.path || `/organization/${organizationId}/users`,
        400,
        duration,
        correlationId,
      );
      return ApiResponse.badRequest(
        'COMMON.BAD_REQUEST',
        { requestId: correlationId, event },
        {
          code: 'BAD_REQUEST',
          details: [
            {
              message: `sortBy must be one of ${allowedSortBy.join(
                ', ',
              )}`,
            },
          ],
        },
      );
    }
    sortBy = rawSortBy as any;
  }

  if (rawSortOrder) {
    const normalized = rawSortOrder.toLowerCase();
    if (normalized !== 'asc' && normalized !== 'desc') {
      const duration = Date.now() - startTime;
      logHttpRequest(
        logger,
        event.httpMethod || 'GET',
        event.path || `/organization/${organizationId}/users`,
        400,
        duration,
        correlationId,
      );
      return ApiResponse.badRequest(
        'COMMON.BAD_REQUEST',
        { requestId: correlationId, event },
        {
          code: 'BAD_REQUEST',
          details: [
            { message: 'sortOrder must be "asc" or "desc"' },
          ],
        },
      );
    }
    sortOrder = normalized as any;
  }

  try {
    const result = await userService.listOrganizationUsers(
      organizationId,
      {
        limit,
        offset,
        status: rawStatus || undefined,
        userType: rawUserType || undefined,
        specialty: rawSpecialty || undefined,
        search: rawSearch || undefined,
        sortBy,
        sortOrder,
      },
    );
    const duration = Date.now() - startTime;
    logger.info({
      event: 'listOrganizationUsers_success',
      count: result.length,
    });
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || `/organization/${organizationId}/users`,
      200,
      duration,
      correlationId,
    );
    return ApiResponse.ok(
      result,
      'ORGANIZATION.LIST_USERS_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({
      event: 'listOrganizationUsers_error',
      err: serializeError(err as Error),
    });
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || `/organization/${organizationId}/users`,
      500,
      duration,
      correlationId,
    );
    return ApiResponse.internalServerError(
      'ORGANIZATION.LIST_USERS_FAILED',
      { requestId: correlationId, event },
      {
        code: 'LIST_ORG_USERS_FAILED',
        details: [
          { message: (err as Error)?.message || 'Unknown error' },
        ],
      },
    );
  }
}

export const main: APIGatewayProxyHandler = async (
  event,
  context: Context,
) => {
  return listOrganizationUsers(event, context);
};

