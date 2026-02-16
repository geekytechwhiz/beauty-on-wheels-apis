import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UserService } from '../services/user.service';
import { createLogger, extractCorrelationId, serializeError, logHttpRequest, extractAwsRequestId, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { UserNotFoundError } from '../utils/errors';
import { getAuthorizerUserId, getAuthorizerOrganizationId } from '../utils/helpers';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

/**
 * Handler for GET /user/organization/{organizationId}/{userId} OR GET /user/organization
 * 
 * This endpoint supports two scenarios:
 * 1. With path parameters: /user/organization/{organizationId}/{userId}
 *    - Uses organizationId and userId from URL path
 * 2. Without path parameters: /user/organization
 *    - Extracts organizationId and userId from authorization token
 * 
 * Both scenarios return the same comprehensive response including:
 * - User details
 * - Organization details
 * - Roles and permissions
 * - Preferences
 * - Account age
 * - And more...
 */
export const main: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = extractAwsRequestId(context);
  const logger = createChildLogger(baseLogger, { correlationId, awsRequestId });

  // Extract query parameters (available for both scenarios)
  const defaultProfile = event.queryStringParameters?.defaultProfile?.trim();
  const userType = event.queryStringParameters?.userType?.trim();

  const requestingUserId = getAuthorizerUserId(event);
  const authHeader = event.headers?.Authorization || event.headers?.authorization;

  // Scenario 1: Try to get userId and organizationId from path parameters
  let userId = event.pathParameters?.userId?.trim();
  let organizationId = event.pathParameters?.organizationId?.trim();

  if (userId === '') userId = undefined;
  if (organizationId === '') organizationId = undefined;

  // Scenario 2: If not in path, use authorizer then optional JWT fallback
  if (!userId || !organizationId) {
    userId = userId || requestingUserId || (event as any).userID || (event as any).userId;
    organizationId = organizationId || getAuthorizerOrganizationId(event) || (event as any).organizationID || (event as any).organizationId;

    // Fallback: Try to decode JWT token from Authorization header if authorizer is not available
    if ((!userId || !organizationId) && authHeader) {
      try {
        if (authHeader && typeof authHeader === 'string') {
          const token = authHeader.replace('Bearer ', '').replace('bearer ', '').trim();
          // Decode JWT without verification (for development/testing)
          // In production, this should be handled by the authorizer
          const base64Url = token.split('.')[1];
          if (base64Url) {
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(
              Buffer.from(base64, 'base64')
                .toString()
                .split('')
                .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
            );
            const decoded = JSON.parse(jsonPayload);
            
            // Extract from common JWT claim formats
            if (!userId) {
              userId = decoded['custom:userID'] || decoded['custom:userId'] || decoded.userID || decoded.userId || decoded.sub;
            }
            if (!organizationId) {
              organizationId = decoded['custom:organizationID'] || decoded['custom:organizationId'] || decoded.organizationID || decoded.organizationId;
            }
            
            logger.debug({
              event: 'jwt_token_decoded',
              hasUserId: !!userId,
              hasOrganizationId: !!organizationId,
              decodedKeys: Object.keys(decoded),
            });
          }
        }
      } catch (err) {
        logger.warn({
          event: 'jwt_decode_error',
          err: serializeError(err),
          message: 'Failed to decode JWT token, will rely on authorizer or return error',
        });
        // Continue without token decoding - will validate below
      }
    }
  }

  logger.info({
    event: 'getUserOrganization_received',
    organizationId,
    userId,
    defaultProfile,
    userType,
    requestingUserId,
    source: userId && organizationId && event.pathParameters?.userId && event.pathParameters?.organizationId 
      ? 'path_parameters' 
      : 'authorization_token',
  });

  // Validate required parameters
  if (!organizationId || !userId) {
    const duration = Date.now() - startTime;
    const path = event.path || '/user/organization';
    logHttpRequest(logger, event.httpMethod || 'GET', path, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'USER.INVALID_REQUEST',
      { requestId: correlationId, event },
      { 
        code: 'INVALID_REQUEST', 
        details: [{ 
          message: 'organizationId and userId are required. Provide them either in the URL path (/user/organization/{organizationId}/{userId}) or ensure they are available in the authorization token.' 
        }] 
      },
    );
  }

  try {
    const userData = await userService.getUserWithOrganizationDetails(
      userId,
      organizationId,
      requestingUserId,
      defaultProfile,
      userType,
      authHeader,
    );

    // Call API endpoint to get userPermissions & role meta: /org/{organizationId}/users/{userId}/permissions
    // Only call when we have both IDs and an auth header
    if (userId && organizationId && authHeader) {
      try {
        logger.debug({ 
          event: 'calling_user_permissions_api', 
          userId, 
          organizationId 
        });
      } catch (apiErr) {
        logger.warn({ 
          event: 'user_permissions_api_call_failed_in_handler', 
          err: serializeError(apiErr),
          userId,
          organizationId 
        });
        // Continue with existing values if API call fails
      }
    }
    
    const duration = Date.now() - startTime;
    const path = event.path || '/user/organization';
    logHttpRequest(logger, event.httpMethod || 'GET', path, 200, duration, correlationId);
    return ApiResponse.ok(userData, 'USER.USER_RETRIEVED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    const path = event.path || '/user/organization';
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', path, 404, duration, correlationId);
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'USER_NOT_FOUND', details: [{ message: err.message }] },
      );
    }
    logger.error({ event: 'getUserOrganization_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', path, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'USER.GET_USER_FAILED',
      { requestId: correlationId, event },
      { code: 'GET_USER_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
};
