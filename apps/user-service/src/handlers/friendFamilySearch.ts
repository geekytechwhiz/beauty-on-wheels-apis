import { createChildLogger, createLogger, extractAwsRequestId, extractCorrelationId, logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { UserRepository } from '../repositories/user.repository';
import { CognitoService } from '../services/cognito.service';
import { FriendFamilyService } from '../services/friendFamily.service';
import { assignUserRole } from '../services/role.service';
import { UserService } from '../services/user.service';
import { PATH_FNF_SEARCH } from '../utils/constants';
import { UserAlreadyExistsError } from '../utils/errors';
import { buildCreateUserPayloadFromFnfSearch, getUserIdAndOrganizationIdFromToken } from '../utils/helpers';
import { friendFamilySearchSchema } from '../validation/friendFamily.validation';
const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const friendFamilyService = new FriendFamilyService();
const userService = new UserService(); 
const userRepository = new UserRepository(); 
export async function main(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  const authHeader = event.headers?.Authorization ?? event.headers?.authorization;

  if (!authHeader?.trim()) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 401, duration, correlationId);
    return ApiResponse.unauthorized('COMMON.UNAUTHORIZED', { requestId: correlationId, event }, { code: 'UNAUTHORIZED' });
  }

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  const b = body != null && typeof body === 'object' ? (body as Record<string, unknown>) : {};

  // Resolve userID and organizationID only from Cognito (JWT claims then AdminGetUser)
  const fromToken = getUserIdAndOrganizationIdFromToken(authHeader);
  let userID = "";
  let organizationID = fromToken.organizationId; 
  if (fromToken.sub) {
    const region = process.env.REGION ?? process.env.AWS_REGION ?? 'us-east-1';
    const userPoolId = process.env.COGNITO_USER_POOL_ID ?? '';
    const cognitoService = new CognitoService(region, userPoolId);
    const attrs = await cognitoService.getUserAttributes(fromToken.sub);
    userID = attrs.userID ?? ""; 
  }
  

  if (!organizationID) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.MISSING_ORGANIZATION_ID',
      { requestId: correlationId, event },
      { code: 'MISSING_ORGANIZATION_ID', details: [{ message: 'Organization ID is required' }] },
    );
  }

  if (!userID) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.MISSING_USER_ID',
      { requestId: correlationId, event },
      { code: 'MISSING_USER_ID', details: [{ message: 'User ID is required' }] },
    );
  }
 
  const validation = friendFamilySearchSchema.safeParse({ ...b, organizationID: organizationID });
  
  if (!validation.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 400, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      { code: 'VALIDATION_ERROR', details: validation.error.issues },
    );
  }

  try {
    const result = await friendFamilyService.searchFnf(organizationID as string, userID, validation.data as any, authHeader);
    const duration = Date.now() - startTime;
    if (result.success && result.invitedUser && result.data) {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 200, duration, correlationId);
      return ApiResponse.ok(
        result.data,
        'FRIEND_FAMILY.SEARCH_SUCCESS',
        { requestId: correlationId, event },
      );
    }

    // User not found: run full invite flow (createUser) then return invitedUser + data or UNABLE_TO_INVITE_USER
    logger.info({ 
      event: 'friend_family_search_invite_flow_start', 
      userID, 
      organizationID,
      searchResult: { success: result.success, hasInvitedUser: !!result.invitedUser, hasData: !!result.data },
      requestBody: { email: validation.data?.email, phone: validation.data?.phone, fullName: validation.data?.fullName }
    });
    try {
      await friendFamilyService.checkFriendFamilyLimit(userID);
      const userData = buildCreateUserPayloadFromFnfSearch(validation.data as any, organizationID as string, userID) as any;
      const roleIds = Array.isArray(userData.userRole) ? userData.userRole.map((r: string) => String(r)) : [];
      if (roleIds.length > 0) {
        try {
          const rolePermissions = await userRepository.getRolePermissions(roleIds[0], organizationID as string,);
          if (rolePermissions?.length > 0) {
            const exactMatch = rolePermissions.find((item: any) => item.SK === `ROLE#${roleIds[0]}`) || rolePermissions[0];
            const definedRoleCode = exactMatch?.definedRoleCode;
            if (definedRoleCode != null) userData.definedRoleCode = String(definedRoleCode);
          }
        } catch (roleErr) {
          logger.warn({ event: 'friend_family_invite_role_fetch_warn', err: serializeError(roleErr) });
        }
      }
      const newUser = await userService.createUser(
        userData,
        userID,
        organizationID as string,
        correlationId,
        authHeader,
        undefined,
        undefined,
      );

      if (roleIds.length > 0) {
        try {
          await assignUserRole(
            roleIds[0],
            organizationID as string,
            newUser.userID,
            validation?.data?.fullName ?? '',
            (validation?.data?.email ?? '').toString().trim(),
            (validation?.data?.phone ?? '').toString().trim(),
            '',
            authHeader,
          );
        } catch (assignErr) {
          logger.warn({ event: 'friend_family_invite_assign_role_warn', err: serializeError(assignErr) });
        }
      }

      const emailVal = (validation?.data?.email ?? '').toString().trim();
      const phoneVal = (validation?.data?.phone ?? '').toString().trim();
      const inviteData: Record<string, unknown> = { invitedUser: newUser.userID };
      if (emailVal.length > 0) {
        (inviteData as any).email = { isVerified: true, emailId: emailVal, userId: newUser.userID };
      }
      if (phoneVal.length > 0) {
        (inviteData as any).phone = { isVerified: true, phoneNumb: phoneVal, userId: newUser.userID };
      }
      const durationInvite = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 200, durationInvite, correlationId);
      return ApiResponse.ok(inviteData, 'FRIEND_FAMILY.INVITE_SUCCESS', { requestId: correlationId, event });
    } catch (inviteErr) {
      const durationInvite = Date.now() - startTime;
      if (inviteErr instanceof UserAlreadyExistsError) {
        logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 409, durationInvite, correlationId);
        return ApiResponse.conflict(
          'FRIEND_FAMILY.UNABLE_TO_INVITE_USER',
          { requestId: correlationId, event },
          { code: 'UNABLE_TO_INVITE_USER', details: [{ message: (inviteErr as Error).message }] },
        );
      }
      logger.error({ event: 'friend_family_invite_error', err: serializeError(inviteErr) });
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 400, durationInvite, correlationId);
      return ApiResponse.badRequest(
        'FRIEND_FAMILY.UNABLE_TO_INVITE_USER',
        { requestId: correlationId, event },
        { code: 'UNABLE_TO_INVITE_USER', details: [{ message: (inviteErr as Error)?.message || 'Unable to invite user' }] },
      );
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    const msg = (err as Error)?.message;
    if (['ORGANIZATION_NOT_EXIST', 'ORGANIZATION_IS_ON_HOLD'].includes(msg ?? '')) {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 400, duration, correlationId);
      return ApiResponse.badRequest(`FRIEND_FAMILY.${msg}`, { requestId: correlationId, event }, { code: msg! });
    }
    if (['USER_CANNOT_INVITE_MORE_FNF', 'USER_ALREADY_INVITED_BY_SOMEONE', 'USER_ALREADY_INVITED', 'EMAIL_OR_PHONE_REQUIRED'].includes(msg ?? '')) {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 400, duration, correlationId);
      return ApiResponse.badRequest(`FRIEND_FAMILY.${msg}`, { requestId: correlationId, event }, { code: msg! });
    }
    logger.error({ event: 'friendFamilySearch_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 500, duration, correlationId);
    return ApiResponse.internalServerError('FRIEND_FAMILY.INTERNAL_SERVER_ERROR', { requestId: correlationId, event }, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
