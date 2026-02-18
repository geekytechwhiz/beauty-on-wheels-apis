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
import { OrganizationRepository } from '../repositories/organization.repository';
import {
  getAuthorizerUserId,
  getAuthorizerOrganizationId,
} from '../utils/helpers';
import { UserNotFoundError } from '../utils/errors';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();
const organizationRepository = new OrganizationRepository();

 async function getUser(
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  const tempLogger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });

  const pathParams = event.pathParameters || {};
  const authorizer = (event.requestContext as any)?.authorizer;

  let userId: string | undefined =
    pathParams?.userId && typeof pathParams.userId === 'string'
      ? pathParams.userId.trim()
      : pathParams?.userID && typeof pathParams.userID === 'string'
      ? pathParams.userID.trim()
      : undefined;
  let organizationId: string | undefined =
    pathParams?.organizationId &&
    typeof pathParams.organizationId === 'string'
      ? pathParams.organizationId.trim()
      : pathParams?.organizationID &&
        typeof pathParams.organizationID === 'string'
      ? pathParams.organizationID.trim()
      : undefined;

  if (!userId) userId = getAuthorizerUserId(event);
  if (!organizationId) organizationId = getAuthorizerOrganizationId(event);

  if (event && typeof event === 'object') {
    const eventAny = event as any;
    if (!userId) {
      const candidate =
        (eventAny.userID && typeof eventAny.userID === 'string'
          ? eventAny.userID
          : eventAny.userId && typeof eventAny.userId === 'string'
          ? eventAny.userId
          : undefined) ?? undefined;
      userId = candidate;
    }
    if (!organizationId) {
      const candidate =
        (eventAny.organizationID &&
        typeof eventAny.organizationID === 'string'
          ? eventAny.organizationID
          : eventAny.organizationId &&
            typeof eventAny.organizationId === 'string'
          ? eventAny.organizationId
          : undefined) ?? undefined;
      organizationId = candidate;
    }
  }

  let userType: string | undefined = undefined;
  let defaultProfile: string | undefined = undefined;

  if (event && typeof event === 'object') {
    const eventAny = event as any;
    if (typeof eventAny.userType === 'string') {
      userType = eventAny.userType;
    }
    if (typeof eventAny.defaultProfile === 'string') {
      defaultProfile = eventAny.defaultProfile;
    }
  }

  if (!userType && authorizer && typeof authorizer.userType === 'string') {
    userType = authorizer.userType;
  }

  if (
    userId === '' ||
    (userId && typeof userId === 'string' && userId.trim() === '')
  )
    userId = undefined;
  if (
    organizationId === '' ||
    (organizationId &&
      typeof organizationId === 'string' &&
      organizationId.trim() === '')
  )
    organizationId = undefined;
  if (
    userType === '' ||
    (userType && typeof userType === 'string' && userType.trim() === '')
  )
    userType = undefined;
  if (
    defaultProfile === '' ||
    (defaultProfile &&
      typeof defaultProfile === 'string' &&
      defaultProfile.trim() === '')
  )
    defaultProfile = undefined;

  if (
    (!userId || !organizationId || !userType) &&
    event.headers?.Authorization
  ) {
    try {
      const authHeader =
        event.headers.Authorization || event.headers.authorization;
      if (authHeader && typeof authHeader === 'string') {
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (token && token.length > 0) {
          const tokenParts = token.split('.');
          if (tokenParts.length >= 2 && tokenParts[1]) {
            try {
              const base64Url = tokenParts[1];
              const base64 = base64Url
                .replace(/-/g, '+')
                .replace(/_/g, '/');
              const decodedBuffer = Buffer.from(base64, 'base64');
              const jsonPayload = decodeURIComponent(
                decodedBuffer
                  .toString()
                  .split('')
                  .map(
                    (c) =>
                      '%' +
                      ('00' + c.charCodeAt(0).toString(16)).slice(-2),
                  )
                  .join(''),
              );

              if (jsonPayload && jsonPayload.trim().length > 0) {
                const decoded = JSON.parse(jsonPayload);

                if (!userId && decoded) {
                  let candidate =
                    decoded['custom:userID'] ||
                    decoded['custom:userId'] ||
                    decoded.userID ||
                    decoded.userId ||
                    decoded.sub ||
                    undefined;
                  if (candidate && typeof candidate !== 'string') {
                    candidate = String(candidate);
                  }
                  userId = candidate;
                }
                if (!organizationId && decoded) {
                  let candidate =
                    decoded['custom:organizationID'] ||
                    decoded['custom:organizationId'] ||
                    decoded.organizationID ||
                    decoded.organizationId ||
                    undefined;
                  if (candidate && typeof candidate !== 'string') {
                    candidate = String(candidate);
                  }
                  organizationId = candidate;
                }
                if (!userType && decoded) {
                  let candidate =
                    decoded['custom:userType'] || decoded.userType || undefined;
                  if (candidate && typeof candidate !== 'string') {
                    candidate = String(candidate);
                  }
                  userType = candidate;
                }
              }
            } catch (parseErr) {
              tempLogger.warn({
                event: 'getUser_token_parse_error',
                err: serializeError(parseErr as Error),
                correlationId,
                hasToken: !!token,
                tokenLength: token?.length,
                tokenPartsCount: tokenParts?.length,
              });
            }
          }
        }
      }
    } catch (err) {
      tempLogger.warn({
        event: 'getUser_token_decode_error',
        err: serializeError(err as Error),
        correlationId,
        hasAuthHeader:
          !!event.headers?.Authorization ||
          !!event.headers?.authorization,
      });
    }
  }

  if (
    defaultProfile &&
    typeof defaultProfile === 'string' &&
    defaultProfile.trim() !== ''
  ) {
    userId = defaultProfile.trim();
  }

  if (!userId || !organizationId) {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      ...(awsRequestId && { awsRequestId }),
    });
    const duration = Date.now() - startTime;
    const defaultPath =
      event.pathParameters?.userId && event.pathParameters?.organizationId
        ? '/dev/user/organization/{organizationId}/{userId}'
        : '/dev/user/organization';
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || defaultPath,
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
              !userId && !organizationId
                ? 'userId and organizationId are required. Please provide them either in the URL path parameters or in the authorization token.'
                : !userId
                ? 'userId is required. Please provide it either in the URL path parameter or in the authorization token.'
                : 'organizationId is required. Please provide it either in the URL path parameter or in the authorization token.',
          },
        ],
      },
    );
  }

  const logger = createChildLogger(baseLogger, {
    correlationId,
    userId,
    organizationId,
    userType,
    defaultProfile,
    ...(awsRequestId && { awsRequestId }),
  });
  const userIdSource = event.pathParameters?.userId ? 'url' : 'token';
  const organizationIdSource = event.pathParameters?.organizationId
    ? 'url'
    : 'token';
  logger.info({
    event: 'getUser_received',
    userIdSource,
    organizationIdSource,
    userType,
    defaultProfile,
  });

  try {
    const user = await userService.getUser(userId!, organizationId!);

    if (!user || typeof user !== 'object') {
      logger.error({
        event: 'getUser_invalid_user_object',
        userId,
        organizationId,
      });
      throw new UserNotFoundError(userId!);
    }

    let orgData: any = null;
    try {
      orgData = await organizationRepository.getOrganizationFromDB(
        organizationId!,
      );
      if (!orgData) {
        logger.warn({
          event: 'getUser_org_data_not_found',
          organizationId,
        });
      }
    } catch (orgErr) {
      logger.warn({
        event: 'getUser_org_data_fetch_error',
        err: serializeError(orgErr as Error),
        organizationId,
      });
      orgData = null;
    }

    let transformedUser: any;
    try {
      transformedUser = await userService.transformUserForResponse(
        user,
        organizationId!,
        userType,
        orgData,
        defaultProfile,
      );
    } catch (transformErr) {
      logger.error({
        event: 'getUser_transform_error',
        err: serializeError(transformErr as Error),
        userId,
        organizationId,
      });
      transformedUser = {
        userID: (user as any).userID || userId || '',
        organizationID: (user as any).organizationID || organizationId || '',
        emailAddress: (user as any).emailAddress || '',
        phoneNumber: (user as any).phoneNumber || '',
        firstName: (user as any).firstName || '',
        lastName: (user as any).lastName || '',
        fullName: (user as any).fullName || '',
      };
    }

    const duration = Date.now() - startTime;
    const defaultPath =
      event.pathParameters?.userId && event.pathParameters?.organizationId
        ? `/dev/user/organization/${organizationId}/${userId}`
        : '/dev/user/organization';
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || defaultPath,
      200,
      duration,
      correlationId,
    );
    return ApiResponse.ok(
      transformedUser,
      'USER.USER_RETRIEVED_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    const defaultPath =
      event.pathParameters?.userId && event.pathParameters?.organizationId
        ? `/dev/user/organization/${organizationId}/${userId}`
        : '/dev/user/organization';
    if (err instanceof UserNotFoundError) {
      logHttpRequest(
        logger,
        event.httpMethod || 'GET',
        event.path || defaultPath,
        404,
        duration,
        correlationId,
      );
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        {
          code: 'USER_NOT_FOUND',
          details: [{ message: err.message }],
        },
      );
    }
    logger.error({ event: 'getUser_error', err: serializeError(err as Error) });
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || defaultPath,
      500,
      duration,
      correlationId,
    );
    return ApiResponse.internalServerError(
      'USER.GET_USER_FAILED',
      { requestId: correlationId, event },
      {
        code: 'GET_USER_FAILED',
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
  return getUser(event, context);
};
