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
import { v2UserListSchema } from '../validation/v2-user-list.validation';
import { V2UserListService } from '../services/v2-user-list.service';
import { getAuthorizerUserId, getAuthorizerOrganizationId } from '../utils/helpers';
import { PATH_V2_USER_LIST } from '../utils/constants';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const v2UserListService = new V2UserListService();

export async function v2UserList(
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  const authUserId = getAuthorizerUserId(event);
  const authOrgId = getAuthorizerOrganizationId(event);

  const logger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
    ...(authUserId && { authUserId }),
    ...(authOrgId && { authOrgId }),
  });

  logger.info({ event: 'v2_user_list_handler_start' });

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    const validation = v2UserListSchema.safeParse(body);

    if (!validation.success) {
      logger.warn({
        event: 'v2_user_list_validation_failed',
        errors: validation.error.issues,
      });

      const duration = Date.now() - startTime;
      logHttpRequest(
        logger,
        event.httpMethod || 'POST',
        PATH_V2_USER_LIST,
        400,
        duration,
        correlationId,
      );

      return ApiResponse.badRequest(
        'Validation Error',
        { requestId: correlationId },
        {
          code: 'VALIDATION_ERROR',
          details: validation.error.issues.map((issue) => ({
            message: issue.message,
            field: issue.path.join('.'),
          })),
        },
      );
    }

    const { organizationId, context: userListContext, filters, pagination, sort } = validation.data;

    logger.info({
      event: 'v2_user_list_params',
      organizationId,
      context: userListContext,
      hasFilters: !!filters,
      hasPagination: !!pagination,
      hasSort: !!sort,
    });

    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    // Normalize patient-related userTypes to USER (backend stores patients as userType USER)
    const normalizedFilters = {
      ...filters,
      userTypes: [
        ...new Set(
          (filters?.userTypes ?? []).map((t) =>
            ['patient', 'patients', 'PATIENT'].includes(String(t?.toLowerCase?.() ?? t))
              ? 'USER'
              : t
          )
        ),
      ],
    };
    const result = await v2UserListService.listUsers({
      organizationId,
      context: userListContext,
      filters:normalizedFilters,
      pagination: {
        limit: pagination?.limit ?? 20,
        cursor: pagination?.cursor ?? null,
      },
      sort: {
        field: sort?.field ?? 'createdDate',
        order: sort?.order ?? 'DESC',
      },
      requestId: correlationId,
      authUserId,
      authHeader,
    });

    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'POST',
      PATH_V2_USER_LIST,
      200,
      duration,
      correlationId,
    );

    logger.info({
      event: 'v2_user_list_success',
      count: result.data.items.length,
      hasNextCursor: !!result.meta.nextCursor,
      duration,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Correlation-Id,X-Requested-With',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
      },
      body: JSON.stringify(result),
    };
  } catch (err) {
    const duration = Date.now() - startTime;

    logger.error({
      event: 'v2_user_list_error',
      err: serializeError(err),
    });

    logHttpRequest(
      logger,
      event.httpMethod || 'POST',
      PATH_V2_USER_LIST,
      500,
      duration,
      correlationId,
    );

    const errorMessage = (err as Error)?.message || 'Unknown error';

    if (errorMessage.includes('required')) {
      return ApiResponse.badRequest(
        {
          title: 'Bad Request',
          description: errorMessage,  
        },
        { requestId: correlationId },
      );
    }

    return ApiResponse.internalServerError(
      {
        title: 'Internal Server Error',
        description: 'Failed to fetch users',
      },
      { requestId: correlationId },
    );
  }
}

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return v2UserList(event, context);
};
