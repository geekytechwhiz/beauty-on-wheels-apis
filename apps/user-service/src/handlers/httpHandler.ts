import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { UserService } from '../services/user.service';
import { assignUserRole } from '../services/role.service';
import { OrganizationRepository } from '../repositories/organization.repository';
import { UserRepository } from '../repositories/user.repository';
import { createLogger, extractCorrelationId, serializeError, logHttpRequest, extractAwsRequestId, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import {
  createUserSchema,
  updateUserSchema,
  assignUserToOrganizationSchema,
  updateUserMetadataSchema,
  assignDoctorSchema,
  listDoctorPatientsSchema,
} from '../validation/user.validation';
import { UserNotFoundError, UserAlreadyExistsError } from '../utils/errors';
import { getOrganization } from '../services/organization.service';
import { PackageRepository } from '../repositories/package.repositrory';
import { RoleRepository } from '../repositories/role.repository';
import { FriendFamilyService } from '../services/friendFamily.service';
import {
  addMemberFriendFamilySchema,
  friendFamilySearchSchema,
  updateFriendFamilySchema,
  fetchFriendFamilySchema,
  deleteFriendFamilySchema,
} from '../validation/friendFamily.validation';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const friendFamilyService = new FriendFamilyService();
const userService = new UserService();
const organizationRepository = new OrganizationRepository();
const userRepository = new UserRepository();
const packagRepository = new PackageRepository();
const roleRepository = new RoleRepository();

export async function createUser(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'createUser_received', eventData: event });

  let body: any;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'createUser_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users', 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] },
    );
  }

  if (!body?.organizationID) {
    if ((event as any).organizationID) {
      body.organizationID = (event as any).organizationID;
    } else if ((event as any).requestContext?.authorizer?.organizationID) {
      body.organizationID = (event as any).requestContext.authorizer.organizationID;
    }
  }

  if (!body?.userID) {
    if ((event as any).userID) {
      body.userID = (event as any).userID;
    } else if ((event as any).requestContext?.authorizer?.userID) {
      body.userID = (event as any).requestContext.authorizer.userID;
    }
  }
  logger.info({ event: 'createUser_organization_check', organizationID: body.organizationID, userID: body.userID });
  const validation = createUserSchema.safeParse(body);
  
  if (!validation.success) {
    logger.warn({ event: 'createUser_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users', 400, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    );
  }

  try {
    const { userInfo, userRole, userType } = validation.data;
    const organizationID = body.organizationID;
    const authHeader =
      event.headers?.Authorization ||
      event.headers?.authorization ||
      event.headers?.AUTHORIZATION;

    // Validate organization exists and is available via Organization API
    if (organizationID) {
      const org = await getOrganization(organizationID, authHeader);
      if (!org) {
        const duration = Date.now() - startTime;
        logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users', 400, duration, correlationId);
        return ApiResponse.badRequest(
          'ORGANIZATION.NOT_FOUND',
          { requestId: correlationId, event },
          { code: 'ORGANIZATION_NOT_FOUND', details: [{ message: 'Organization does not exist', field: 'organizationID' }] },
        );
      }
      const status = org.status ? String(org.status).toLowerCase() : '';
      if (['on_hold', 'disabled', 'not_exist'].includes(status)) {
        const duration = Date.now() - startTime;
        logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users', 400, duration, correlationId);
        return ApiResponse.badRequest(
          'ORGANIZATION.NOT_AVAILABLE',
          { requestId: correlationId, event },
          { code: 'ORGANIZATION_NOT_AVAILABLE', details: [{ message: 'Organization is not available', field: 'organizationID' }] },
        );
      }
    }

    const roleIds = Array.isArray(userRole)
      ? userRole.map((roleId) => String(roleId))
      : userRole
        ? [String(userRole)]
        : [];
    const contactAddress = (userInfo.contact as any)?.address;
    const userTypeUpper = String(userType || '').toUpperCase();
    const userData: any = {
      fullName: userInfo.name,
      namePrefix: userInfo.namePrefix,
      profilePic: userInfo.profilePic,
      code: userInfo.code,
      licenseNumber: userInfo.licenseNumber,
      emailAddress: userInfo.contact.email,
      phoneNumber: userInfo.contact.phone,
      phoneCode: userInfo.contact.phoneCode,
      dateOfBirth: userInfo.dateOfBirth,
      department: userInfo.department,
      gender: userInfo.gender,
      specialty: userInfo.specialty,
      slotDurationInMinutes: userInfo.slotDurationInMinutes,
      experienceInYears: userInfo.experienceInYears,
      bio: userInfo.bio,
      userRole: userRole,
      userType: userType,
      ...(userTypeUpper === 'STAFF' ? { workingHours: userInfo.workingHours || {} } : 
          (userInfo.workingHours ? { workingHours: userInfo.workingHours } : {})),
      address: contactAddress?.address || userInfo.address || '',
      city: contactAddress?.city || userInfo.city || '',
      state: contactAddress?.state || userInfo.state || '',
      country: contactAddress?.country || userInfo.country || '',
      postalCode: contactAddress?.postalCode || userInfo.postalCode || '',
      street: contactAddress?.street || '',
      zip: contactAddress?.zip || '',
      countryCode: contactAddress?.countryCode || '',
      stateCode: contactAddress?.stateCode || '',
      emergencyContact: (userInfo as any).emergencyContact || {},
      medicalHistory: (userInfo as any).medicalHistory || {},
      insuranceDetails: (userInfo as any).insuranceDetails || {},
      workSchedule: (userInfo as any).workSchedule || {},
      position: (userInfo as any).position || '',
      userTimeZone: (userInfo as any).userTimeZone || '',
      devices: (userInfo as any).devices || [],
      assignRoomNo: (userInfo as any).assignRoomNo || undefined,
      username: (userInfo as any).username || undefined,
    };
    
    const isEmail = userInfo.contact.email && userInfo.contact.email.includes('@');
    userData.srcRegisEntity = isEmail ? 'email' : 'phone_number';
    let definedRoleCode: string | undefined;
    
    // Fetch definedRoleCode directly from repository (database query)
    if (roleIds.length > 0) {
      logger.info({
        event: 'createUser_fetch_definedRoleCode_from_repo',
        organizationID: body.organizationID,
        roleIds,
        firstRoleId: roleIds[0],
      });
      try {
        const rolePermissions = await userRepository.getRolePermissions(roleIds[0], body.organizationID);
        logger.info({ 
          event: 'createUser_repo_query_result', 
          rolePermissionsCount: rolePermissions?.length || 0,
          hasItems: rolePermissions && rolePermissions.length > 0,
        });
        if (rolePermissions && rolePermissions.length > 0) {
          // Find the exact match for the role (SK should match exactly)
          const exactRoleMatch = rolePermissions.find(
            (item: any) => item.SK === `ROLE#${roleIds[0]}`
          ) || rolePermissions[0]; // Fallback to first item if exact match not found
          logger.info({ 
            event: 'createUser_role_detail_found', 
            hasExactMatch: exactRoleMatch?.SK === `ROLE#${roleIds[0]}`,
            roleDetailKeys: exactRoleMatch ? Object.keys(exactRoleMatch) : [],
            hasDefinedRoleCode: exactRoleMatch?.definedRoleCode !== undefined,
          });
          definedRoleCode = exactRoleMatch?.definedRoleCode;
          const roleName = exactRoleMatch?.roleName;
          userData.roleName = roleName || definedRoleCode || '';
          console.log("DEFINED ROLE CODE :", definedRoleCode);  
          console.log("EXACT ROLE MATCH :", JSON.stringify(exactRoleMatch));  

          const hasExistingFeatures =
            Array.isArray((exactRoleMatch as any)?.features) &&
            (exactRoleMatch as any).features.length > 0;
          console.log("ADMIN ROLE HAS EXISTING FEATURES :", hasExistingFeatures);

          // Only seed org features into ADMIN role when it has no features
          if (definedRoleCode === 'ADMIN' && !hasExistingFeatures) {
            const authHeader = event.headers?.Authorization || event.headers?.authorization;
            const orgFetaures = await packagRepository.getOrgFeatures(body.organizationID, authHeader);
            if (orgFetaures && orgFetaures.length > 0) {
             const {roleId, roleName, roleDescription, roleType } = exactRoleMatch as any;
              await roleRepository.saveRoles(body.organizationID, roleId, roleName, roleDescription,roleType, orgFetaures, authHeader);
            }
          }
          logger.info({ 
            event: 'createUser_definedRoleCode_from_repo', 
            found: !!definedRoleCode,
            definedRoleCode,
            definedRoleCodeType: typeof definedRoleCode,
          });
        } else {
          logger.warn({ 
            event: 'createUser_repo_no_items', 
            message: 'Repository query returned no items',
            roleId: roleIds[0],
            organizationID: body.organizationID,
          });
        }
      } catch (err) {
        logger.error({ 
          event: 'createUser_definedRoleCode_repo_error', 
          err: serializeError(err),
          roleId: roleIds[0],
          organizationID: body.organizationID,
        });
      }
    } else {
      logger.warn({
        event: 'createUser_role_missing',
        organizationID: body.organizationID,
        userType: userTypeUpper,
      });
    }
    logger.info({ 
      event: 'createUser_definedRoleCode', 
      definedRoleCode,
      willSetInUserData: !!definedRoleCode,
    });
    // Always set definedRoleCode if it exists, even if empty string
    if (definedRoleCode !== undefined && definedRoleCode !== null) {
      userData.definedRoleCode = String(definedRoleCode);
      logger.info({ 
        event: 'createUser_definedRoleCode_set', 
        definedRoleCode: userData.definedRoleCode,
        userDataHasDefinedRoleCode: userData.definedRoleCode !== undefined,
      });
    } else {
      logger.warn({ 
        event: 'createUser_definedRoleCode_not_set', 
        message: 'definedRoleCode is empty/undefined, not setting in userData',
        definedRoleCode,
      });
    }

    // Log userData before passing to service to verify definedRoleCode is included
    logger.info({
      event: 'createUser_userData_before_service',
      userDataKeys: Object.keys(userData),
      hasDefinedRoleCode: userData.definedRoleCode !== undefined,
      definedRoleCode: userData.definedRoleCode,
    });

    const result = await userService.createUser(
      userData,
      body.organizationID,
      body.userID,
      correlationId,
      authHeader,
      body?.userInfo?.friendNFamily,
      body?.userInfo?.assignDoctor,
    );
    console.log("RESULT DATA :", result);
    if (roleIds.length > 0) {
      logger.info({
        event: 'createUser_assign_user_role_start',
        organizationID: body.organizationID,
        userID: result.userID,
        roleId: roleIds[0],
      });
      console.log("AUTH HEADER : ", authHeader);
      
      try {
        const roleAssignmentResult = await assignUserRole(
          roleIds[0],
          body.organizationID,
          result.userID,
          userInfo.name,
          userInfo.contact.email ?? '',
          userInfo.contact.phone ?? '',
          userInfo.profilePic,
          authHeader,
        );
        
        console.log("ROLE ASSIGNMENT RESULT:", roleAssignmentResult);
        
        if (!roleAssignmentResult || roleAssignmentResult.success === false) {
          logger.error({
            event: 'createUser_assign_user_role_failed',
            organizationID: body.organizationID,
            userID: result.userID,
            roleId: roleIds[0],
            result: roleAssignmentResult,
          });
          // Note: User is still created in Cognito and user table, but role assignment failed
        } else {
          logger.info({
            event: 'createUser_assign_user_role_success',
            organizationID: body.organizationID,
            userID: result.userID,
            roleId: roleIds[0],
          });
        }
      } catch (err) {
        logger.error({ 
          event: 'createUser_assign_user_role_exception', 
          err: serializeError(err),
          organizationID: body.organizationID,
          userID: result.userID,
          roleId: roleIds[0],
        });
        // Note: User is still created in Cognito and user table, but role assignment failed
      }
    } else {
      logger.info({
        event: 'createUser_assign_user_role_skipped',
        organizationID: body.organizationID,
        userID: result.userID,
      });
    }
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users', 201, duration, correlationId);
    
    return ApiResponse.created(
      { invitedUser: result.userID },
      'USER.USER_CREATED_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserAlreadyExistsError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users', 409, duration, correlationId);
      return ApiResponse.conflict(
        'USER.USER_ALREADY_EXISTS',
        { requestId: correlationId, event },
        { code: 'USER_ALREADY_EXISTS', details: [{ message: err.message }] },
      );
    }
    logger.error({ event: 'createUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users', 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'USER.CREATE_USER_FAILED',
      { requestId: correlationId, event },
      { code: 'CREATE_USER_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
}


export async function getUser(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  
  // Create logger early for token parsing errors
  const tempLogger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });

  const pathParams = event.pathParameters || {};
  const authorizer = (event.requestContext as any)?.authorizer;

  // Scenario 1: Get userId and organizationId from path parameters - safe string operations
  let userId: string | undefined = (pathParams?.userId && typeof pathParams.userId === 'string') 
    ? pathParams.userId.trim() 
    : ((pathParams?.userID && typeof pathParams.userID === 'string') ? pathParams.userID.trim() : undefined);
  let organizationId: string | undefined = (pathParams?.organizationId && typeof pathParams.organizationId === 'string')
    ? pathParams.organizationId.trim()
    : ((pathParams?.organizationID && typeof pathParams.organizationID === 'string') ? pathParams.organizationID.trim() : undefined);

  // Scenario 2: If not in pathParams, check event.requestContext?.authorizer - safe property access
  if (!userId && authorizer) {
    userId = (authorizer.userID && typeof authorizer.userID === 'string') 
      ? authorizer.userID 
      : ((authorizer.userId && typeof authorizer.userId === 'string') ? authorizer.userId : undefined);
  }
  if (!organizationId && authorizer) {
    organizationId = (authorizer.organizationID && typeof authorizer.organizationID === 'string')
      ? authorizer.organizationID
      : ((authorizer.organizationId && typeof authorizer.organizationId === 'string') ? authorizer.organizationId : undefined);
  }

  // Scenario 3: Also check event object directly - safe property access
  if (!userId && event && typeof event === 'object') {
    const eventAny = event as any;
    userId = (eventAny.userID && typeof eventAny.userID === 'string')
      ? eventAny.userID
      : ((eventAny.userId && typeof eventAny.userId === 'string') ? eventAny.userId : undefined);
  }
  if (!organizationId && event && typeof event === 'object') {
    const eventAny = event as any;
    organizationId = (eventAny.organizationID && typeof eventAny.organizationID === 'string')
      ? eventAny.organizationID
      : ((eventAny.organizationId && typeof eventAny.organizationId === 'string') ? eventAny.organizationId : undefined);
  }

  // Extract userType and defaultProfile from event object directly - safe property access
  let userType: string | undefined = undefined;
  let defaultProfile: string | undefined = undefined;
  
  if (event && typeof event === 'object') {
    const eventAny = event as any;
    userType = (eventAny.userType && typeof eventAny.userType === 'string') ? eventAny.userType : undefined;
    defaultProfile = (eventAny.defaultProfile && typeof eventAny.defaultProfile === 'string') ? eventAny.defaultProfile : undefined;
  }

  // Also check authorizer for userType (if not in event object)
  if (!userType && authorizer && typeof authorizer.userType === 'string') {
    userType = authorizer.userType;
  }

  // Normalize empty strings to undefined - safe string checks
  if (userId === '' || (userId && typeof userId === 'string' && userId.trim() === '')) userId = undefined;
  if (organizationId === '' || (organizationId && typeof organizationId === 'string' && organizationId.trim() === '')) organizationId = undefined;
  if (userType === '' || (userType && typeof userType === 'string' && userType.trim() === '')) userType = undefined;
  if (defaultProfile === '' || (defaultProfile && typeof defaultProfile === 'string' && defaultProfile.trim() === '')) defaultProfile = undefined;

  if ((!userId || !organizationId || !userType) && event.headers?.Authorization) {
    try {
      const authHeader = event.headers.Authorization || event.headers.authorization;
      if (authHeader && typeof authHeader === 'string' && authHeader.trim().length > 0) {
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        
        if (token && token.length > 0) {
          const tokenParts = token.split('.');
          if (tokenParts.length >= 2 && tokenParts[1]) {
            try {
              const base64Url = tokenParts[1];
              const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
              const decodedBuffer = Buffer.from(base64, 'base64');
              const jsonPayload = decodeURIComponent(
                decodedBuffer
                  .toString()
                  .split('')
                  .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                  .join('')
              );
              
              if (jsonPayload && jsonPayload.trim().length > 0) {
                const decoded = JSON.parse(jsonPayload);
                
                // Extract from common JWT claim formats - safe property access
                if (!userId && decoded) {
                  userId = decoded['custom:userID'] || decoded['custom:userId'] || decoded.userID || decoded.userId || decoded.sub || undefined;
                  if (userId && typeof userId !== 'string') userId = String(userId);
                }
                if (!organizationId && decoded) {
                  organizationId = decoded['custom:organizationID'] || decoded['custom:organizationId'] || decoded.organizationID || decoded.organizationId || undefined;
                  if (organizationId && typeof organizationId !== 'string') organizationId = String(organizationId);
                }
                if (!userType && decoded) {
                  userType = decoded['custom:userType'] || decoded.userType || undefined;
                  if (userType && typeof userType !== 'string') userType = String(userType);
                }
              }
            } catch (parseErr) {
              tempLogger.warn({ 
                event: 'getUser_token_parse_error', 
                err: serializeError(parseErr),
                correlationId,
                hasToken: !!token,
                tokenLength: token?.length,
                tokenPartsCount: tokenParts?.length
              });
              // Continue with other sources for userId/organizationId/userType
            }
          }
        }
      }
    } catch (err) {
      tempLogger.warn({ 
        event: 'getUser_token_decode_error', 
        err: serializeError(err),
        correlationId,
        hasAuthHeader: !!event.headers?.Authorization || !!event.headers?.authorization
      });
      // Continue with other sources or return error if validation fails
    }
  }

  // Handle defaultProfile logic (family/friend access) - if set, userId becomes defaultProfile
  if (defaultProfile && typeof defaultProfile === 'string' && defaultProfile.trim() !== '') {
    userId = defaultProfile.trim();
  }

  // Validate that we have both userId and organizationId
  if (!userId || !organizationId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    const defaultPath = event.pathParameters?.userId && event.pathParameters?.organizationId
      ? '/dev/user/organization/{organizationId}/{userId}'
      : '/dev/user/organization';
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || defaultPath, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      { 
        code: 'BAD_REQUEST', 
        details: [{ 
          message: !userId && !organizationId
            ? 'userId and organizationId are required. Please provide them either in the URL path parameters or in the authorization token.'
            : !userId
            ? 'userId is required. Please provide it either in the URL path parameter or in the authorization token.'
            : 'organizationId is required. Please provide it either in the URL path parameter or in the authorization token.'
        }] 
      },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, organizationId, userType, defaultProfile, ...(awsRequestId && { awsRequestId }) });
  const userIdSource = event.pathParameters?.userId ? 'url' : 'token';
  const organizationIdSource = event.pathParameters?.organizationId ? 'url' : 'token';
  logger.info({ event: 'getUser_received', userIdSource, organizationIdSource, userType, defaultProfile });
  
  try {
    const user = await userService.getUser(userId, organizationId);
    
    // Safety check: ensure user is valid
    if (!user || typeof user !== 'object') {
      logger.error({ event: 'getUser_invalid_user_object', userId, organizationId });
      throw new UserNotFoundError(userId);
    }
    
    // Fetch organization data from DynamoDB
    let orgData = null;
    try {
      orgData = await organizationRepository.getOrganizationFromDB(organizationId);
      if (!orgData) {
        logger.warn({ event: 'getUser_org_data_not_found', organizationId });
      }
    } catch (orgErr) {
      logger.warn({ event: 'getUser_org_data_fetch_error', err: serializeError(orgErr), organizationId });
      // Continue without org data - will use defaults
      orgData = null;
    }
    
    // Transform user to match expected response structure - wrapped in try-catch for safety
    let transformedUser;
    try {
      transformedUser = await userService.transformUserForResponse(user, organizationId, userType, orgData, defaultProfile);
    } catch (transformErr) {
      logger.error({ 
        event: 'getUser_transform_error', 
        err: serializeError(transformErr), 
        userId, 
        organizationId 
      });
      // Return a safe fallback response structure
      transformedUser = {
        userID: user.userID || userId || '',
        organizationID: user.organizationID || organizationId || '',
        emailAddress: user.emailAddress || '',
        phoneNumber: user.phoneNumber || '',
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        fullName: user.fullName || '',
      };
    }
    
    const duration = Date.now() - startTime;
    const defaultPath = event.pathParameters?.userId && event.pathParameters?.organizationId
      ? `/dev/user/organization/${organizationId}/${userId}`
      : '/dev/user/organization';
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || defaultPath, 200, duration, correlationId);
    return ApiResponse.ok(
      transformedUser,
      'USER.USER_RETRIEVED_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    const defaultPath = event.pathParameters?.userId && event.pathParameters?.organizationId
      ? `/dev/user/organization/${organizationId}/${userId}`
      : '/dev/user/organization';
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || defaultPath, 404, duration, correlationId);
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'USER_NOT_FOUND', details: [{ message: err.message }] },
      );
    }
    logger.error({ event: 'getUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || defaultPath, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'USER.GET_USER_FAILED',
      { requestId: correlationId, event },
      { code: 'GET_USER_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
}

export async function updateUser(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  
  const baseLogContext = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });

  // Extract from authorizer token
  const authorizer = (event.requestContext as { authorizer?: Record<string, unknown> } | undefined)?.authorizer;
  console.log("AUTHORIZER ", authorizer);
  
  // Extract userID from token
  let requestUserId: string | undefined;
  if (authorizer?.claims) {
    const claims = authorizer.claims as Record<string, unknown>;
    requestUserId = (claims['custom:userID'] as string) ?? (claims['custom:userId'] as string);
  }
  if (!requestUserId && authorizer) {
    requestUserId = (authorizer.userId as string) ?? (authorizer.userID as string);
  }
  
  // Extract organizationID from token
  let requestOrgId: string | undefined;
  
  // Path 1: From claims['custom:organizationID'] - YOUR TOKEN FORMAT
  if (authorizer?.claims) {
    const claims = authorizer.claims as Record<string, unknown>;
    requestOrgId = (claims['custom:organizationID'] as string) ?? 
                   (claims['custom:organizationId'] as string);
  }
  console.log("REQ ORG ID : 1 ", requestOrgId);
  // Path 2: From claims.organizationID (standard claim)
  if (!requestOrgId && authorizer?.claims) {
    const claims = authorizer.claims as Record<string, unknown>;
    requestOrgId = (claims.organizationID as string) ?? (claims.organizationId as string);
  }
  console.log("REQ ORG ID : 2 ", requestOrgId);
  // Path 3: Direct from authorizer (custom authorizer)
  if (!requestOrgId && authorizer) {
    requestOrgId = (authorizer.organizationID as string) ?? (authorizer.organizationId as string);
  }

  console.log("REQ ORG ID : 3 ", requestOrgId);
  
  baseLogContext.info({ 
    event: 'token_data_extracted', 
    requestUserId,
    requestOrgId,
    source: 'claims[custom:*]'
  });

  let body: any;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    baseLogContext.error({ event: 'updateUser_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(baseLogContext, event.httpMethod || 'PUT', event.path || `/users/unknown`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] },
    );
  }

  // Extract from body (with token fallback)
  const bodyUserId = body?.userId || body?.userID;
  const bodyOrganizationId = body?.organizationId || body?.organizationID;
  
  // Prioritize token values, fallback to body for backward compatibility
  const userId = bodyUserId;
  const organizationId = requestOrgId || bodyOrganizationId;

  console.log("USER ID ", userId);
  console.log("ORGANIZATION ID ", organizationId);
  console.log("From Token - UserID:", requestUserId, "OrgID:", requestOrgId);

  if (!userId || !organizationId) {
    const duration = Date.now() - startTime;
    logHttpRequest(baseLogContext, event.httpMethod || 'PUT', event.path || '/user', 401, duration, correlationId);
    return ApiResponse.unauthorized(
      'COMMON.UNAUTHORIZED',
      { requestId: correlationId, event },
      { code: 'UNAUTHORIZED', details: [{ message: 'Missing user context in access token' }] },
    );
  }

  const resolvedUserId = userId;
  const resolvedOrganizationId = organizationId;
  const logger = createChildLogger(baseLogger, { correlationId, userId: resolvedUserId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'updateUser_received', eventData: event });

  const action = body?.action ? String(body.action).toUpperCase() : undefined;
  if (action) {
    const duration = Date.now() - startTime;
    const hasOwn = (obj: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
    const setIfPresent = (target: Record<string, unknown>, key: string, value: unknown) => {
      if (hasOwn(body, key)) {
        target[key] = value;
      }
    };
    const validateWorkingHours = (workingHours: unknown) => {
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      if (!workingHours || typeof workingHours !== 'object') {
        return 'workingHours must be an object';
      }
      const hours = workingHours as Record<string, any>;
      for (const day of days) {
        const dayConfig = hours[day];
        if (!dayConfig || typeof dayConfig !== 'object') {
          return `${day} must be an object`;
        }
        if (typeof dayConfig.available !== 'boolean') {
          return `${day}.available must be a boolean`;
        }
        if (dayConfig.available === true) {
          if (!Array.isArray(dayConfig.availableHours) || dayConfig.availableHours.length === 0) {
            return `${day}.availableHours is required when available is true`;
          }
          for (const entry of dayConfig.availableHours) {
            const from = entry?.from;
            const to = entry?.to;
            const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
            if (!timeRegex.test(String(from || '')) || !timeRegex.test(String(to || ''))) {
              return `${day}.availableHours must include valid from/to in HH:mm format`;
            }
          }
        }
      }
      return undefined;
    };

    try {
      const existing = await userService.getUser(userId, organizationId);
      const userData: Record<string, unknown> = {};

      switch (action) {
        case 'LANGUAGE': {
          if (!body?.language) {
            return ApiResponse.unprocessableEntity(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              { code: 'VALIDATION_ERROR', details: [{ field: 'language', message: 'language is required' }] },
            );
          }
          userData.language = body.language;
          break;
        }
        case 'DATE_FORMAT': {
          if (!body?.dateFormat) {
            return ApiResponse.unprocessableEntity(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              { code: 'VALIDATION_ERROR', details: [{ field: 'dateFormat', message: 'dateFormat is required' }] },
            );
          }
          userData.dateFormat = body.dateFormat;
          break;
        }
        case 'UNITS_SETTINGS': {
          const unitsSettings = body?.unitsSettings ?? body?.units;
          if (!unitsSettings) {
            return ApiResponse.unprocessableEntity(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              { code: 'VALIDATION_ERROR', details: [{ field: 'unitsSettings', message: 'unitsSettings is required' }] },
            );
          }
          userData.unitsSettings = unitsSettings;
          break;
        }
        case 'COMMUNICATION_SETTINGS': {
          const communicationSettings = body?.communicationSettings ?? body?.notifications;
          if (!communicationSettings) {
            return ApiResponse.unprocessableEntity(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              { code: 'VALIDATION_ERROR', details: [{ field: 'communicationSettings', message: 'communicationSettings is required' }] },
            );
          }
          userData.communicationSettings = communicationSettings;
          break;
        }
        case 'GENERAL_SETTINGS': {
          const keys = [
            'promotions',
            'medication',
            'appointment',
            'newsAndArticles',
            'emergencyVital',
            'medicationReminders',
            'appointmentReminders',
            'activityGoals',
            'healthCheckIn',
            'debugMode',
          ];
          const generalSetting: Record<string, unknown> = {};
          for (const key of keys) {
            if (hasOwn(body, key)) {
              generalSetting[key] = body[key];
            }
          }
          if (Object.keys(generalSetting).length === 0) {
            return ApiResponse.unprocessableEntity(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              { code: 'VALIDATION_ERROR', details: [{ field: 'generalSetting', message: 'general settings are required' }] },
            );
          }
          userData.generalSetting = generalSetting;
          break;
        }
        case 'UPLOAD': {
          const srcRegisEntity = String((existing as any).srcRegisEntity || '').toLowerCase();
          const emailInput = hasOwn(body, 'emailAddress') ? body.emailAddress : (hasOwn(body, 'email') ? body.email : undefined);
          const phoneInput = hasOwn(body, 'phoneNumber') ? body.phoneNumber : (hasOwn(body, 'phone') ? body.phone : undefined);
          
          // Normalize email for comparison
          const normalizeEmail = (email: any): string => {
            if (!email) return '';
            return String(email).trim().toLowerCase();
          };
          
          // Normalize phone for comparison (with phoneCode)
          const normalizePhone = (phone: any, phoneCode?: any): string => {
            if (!phone) return '';
            const phoneStr = String(phone).trim();
            const code = phoneCode ? String(phoneCode).trim() : '';
            const composed = code ? `${code}${phoneStr}`.trim() : phoneStr;
            return composed.startsWith('+') ? composed : `+${composed}`;
          };
          
          setIfPresent(userData, 'profilePic', body.profilePic);
          setIfPresent(userData, 'firstName', body.firstName);
          setIfPresent(userData, 'middleName', body.middleName);
          setIfPresent(userData, 'lastName', body.lastName);
          setIfPresent(userData, 'fullName', body.fullName);
          setIfPresent(userData, 'gender', body.gender);
          setIfPresent(userData, 'weightInLbs', body.weightInLbs);
          setIfPresent(userData, 'weightInKG', body.weightInKG);
          setIfPresent(userData, 'heightInCm', body.heightInCm);
          setIfPresent(userData, 'heightInFeet', body.heightInFeet);
          setIfPresent(userData, 'country', body.country);
          setIfPresent(userData, 'dateOfBirth', body.dateOfBirth);
          setIfPresent(userData, 'address', body.address);
          setIfPresent(userData, 'postalCode', body.postalCode);
          setIfPresent(userData, 'zip', body.zip);
          setIfPresent(userData, 'cloudOpt', body.cloudOpt);
          setIfPresent(userData, 'additionalPhoneNumbers', body.additionalPhoneNumbers);
          setIfPresent(userData, 'additionalEmailIDs', body.additionalEmailIDs);
          setIfPresent(userData, 'isRegisteredCompletely', body.isRegisteredCompletely);
          setIfPresent(userData, 'appName', body.appName);
          setIfPresent(userData, 'accountStatus', body.accountStatus);
          setIfPresent(userData, 'phoneLocale', body.phoneLocale);
          setIfPresent(userData, 'locale', body.locale);
          setIfPresent(userData, 'userTimeZone', body.userTimeZone);
          setIfPresent(userData, 'stateCode', body.stateCode);
          setIfPresent(userData, 'countryCode', body.countryCode);
          setIfPresent(userData, 'region', body.region);
          setIfPresent(userData, 'assignRoomNo', body.assignRoomNo);
          setIfPresent(userData, 'lastAppointment', body.lastAppointment);
          setIfPresent(userData, 'state', body.state);
          setIfPresent(userData, 'street', body.street);
          setIfPresent(userData, 'city', body.city);
          setIfPresent(userData, 'position', body.position);
          setIfPresent(userData, 'department', body.department);
          setIfPresent(userData, 'licenseNumber', body.licenseNumber);
          setIfPresent(userData, 'specialty', body.specialty);
          setIfPresent(userData, 'experienceInYears', body.experienceInYears);
          setIfPresent(userData, 'bio', body.bio);
          setIfPresent(userData, 'ethnicity', body.ethnicity);
          setIfPresent(userData, 'maritalStatus', body.maritalStatus);
          setIfPresent(userData, 'bloodGroup', body.bloodGroup);
          setIfPresent(userData, 'namePrefix', body.namePrefix);
          setIfPresent(userData, 'appleHealthLastSync', body.appleHealthLastSync);
          setIfPresent(userData, 'googleFitLastSync', body.googleFitLastSync);
          if (emailInput !== undefined) {
            userData.emailAddress = emailInput;
          }
          if (phoneInput !== undefined) {
            userData.phoneNumber = phoneInput;
          }
          if (hasOwn(body, 'phoneCode')) {
            userData.phoneCode = body.phoneCode;
          }
          if (Array.isArray(body.acceptedAppForms)) {
            const existingForms = Array.isArray((existing as any).acceptedAppForms)
              ? (existing as any).acceptedAppForms
              : [];
            const merged = [...existingForms];
            for (const form of body.acceptedAppForms) {
              const versionId = (form as any)?.versionId;
              if (!versionId || merged.some((existingForm) => existingForm.versionId === versionId)) {
                continue;
              }
              merged.push({ ...form, acceptedDate: Date.now() });
            }
            userData.acceptedAppForms = merged;
          }
          break;
        }
        case 'DELETE': {
          userData.profilePic = '';
          break;
        }
        case 'ALLERGIES': {
          userData.medicalHistory = {
            ...(existing.medicalHistory || {}),
            allergies: Array.isArray(body?.allergies) ? body.allergies : [],
          };
          break;
        }
        case 'CHIEF_MEDICAL_ISSUE': {
          if (!body?.chiefMedicalIssue) {
            return ApiResponse.unprocessableEntity(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              { code: 'VALIDATION_ERROR', details: [{ field: 'chiefMedicalIssue', message: 'chiefMedicalIssue is required' }] },
            );
          }
          userData.chiefMedicalIssue = body.chiefMedicalIssue;
          break;
        }
        case 'SUBSTANCE_MISUSE': {
          setIfPresent(userData, 'smoking', body.smoking ?? '');
          setIfPresent(userData, 'alcoholConsumption', body.alcoholConsumption ?? '');
          break;
        }
        case 'EMERGENCY_CONTACT': {
          if (!body?.emergencyContact || Object.keys(body.emergencyContact).length === 0) {
            return ApiResponse.unprocessableEntity(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              { code: 'VALIDATION_ERROR', details: [{ field: 'emergencyContact', message: 'emergencyContact is required' }] },
            );
          }
          userData.emergencyContact = body.emergencyContact;
          break;
        }
        case 'WORKING_HOURS': {
          const validationMessage = validateWorkingHours(body?.workingHours);
          if (validationMessage) {
            return ApiResponse.unprocessableEntity(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              { code: 'VALIDATION_ERROR', details: [{ field: 'workingHours', message: validationMessage }] },
            );
          }
          userData.workingHours = body.workingHours;
          if (body?.slotDurationInMinutes !== undefined) {
            userData.slotDurationInMinutes = body.slotDurationInMinutes;
          } else {
            userData.slotDurationInMinutes = 30;
          }
          break;
        }
        default: {
          return ApiResponse.badRequest(
            'COMMON.BAD_REQUEST',
            { requestId: correlationId, event },
            { code: 'ACTION_SHOULD_BE_DELETE_AND_UPLOAD' },
          );
        }
      }

      await userService.updateUser(resolvedUserId, resolvedOrganizationId, userData, correlationId);
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/user', 200, duration, correlationId);
      return ApiResponse.ok(
        {}, 
        { 
          title: 'Success', 
          description: 'The operation completed successfully.' 
        }, 
        { requestId: correlationId, event }
      );
    } catch (err) {
      logger.error({ event: 'updateUser_action_error', err: serializeError(err) });
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/user', 500, duration, correlationId);
      return ApiResponse.internalServerError(
        'USER.UPDATE_USER_FAILED',
        { requestId: correlationId, event },
        { code: 'UPDATE_USER_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
      );
    }
  }

  const validation = updateUserSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'updateUser_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/user', 400, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    );
  }

  try {
    const data = validation.data;
    
    // Build update data object - map flat structure to internal format
    const userData: any = {};
    
    // Map basic fields
    if (data.profilePic !== undefined) userData.profilePic = data.profilePic;
    if (data.namePrefix !== undefined) userData.namePrefix = data.namePrefix;
    if (data.bio !== undefined) userData.bio = data.bio;
    if (data.gender !== undefined) userData.gender = data.gender;
    if (data.dateOfBirth !== undefined) userData.dateOfBirth = data.dateOfBirth;
    if (data.specialty !== undefined) userData.specialty = data.specialty;
    if (data.department !== undefined) userData.department = data.department;
    if (data.licenseNumber !== undefined) userData.licenseNumber = data.licenseNumber;
    
    // Map contact fields
    if (data.email !== undefined) userData.emailAddress = data.email;
    if (data.phone !== undefined) userData.phoneNumber = data.phone;
    if (data.phoneCode !== undefined) userData.phoneCode = data.phoneCode;
    
    // Map name fields - firstName and lastName (fullName will be constructed in service)
    if (data.firstName !== undefined) userData.firstName = data.firstName;
    if (data.lastName !== undefined) userData.lastName = data.lastName;
    if (data.fullName !== undefined) userData.fullName = data.fullName;
    if (data.name !== undefined) userData.fullName = data.name;

    // Map address fields
    if (data.address !== undefined) userData.address = data.address;
    if (data.city !== undefined) userData.city = data.city;
    if (data.state !== undefined) userData.state = data.state;
    if (data.country !== undefined) userData.country = data.country;
    if (data.postalCode !== undefined) userData.postalCode = data.postalCode;
    if (data.countryCode !== undefined) userData.countryCode = data.countryCode;
    
    // Update srcRegisEntity if email or phone is being updated
    if (data.email !== undefined || data.phone !== undefined) {
      const isEmail = data.email && data.email.includes('@');
      userData.srcRegisEntity = isEmail ? 'email' : 'phone_number';
    }
    
    // Note: 'action' field is accepted but not stored in user data (may be used for business logic)
    
    await userService.updateUser(userId, organizationId, userData, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/user', 200, duration, correlationId);
    return ApiResponse.ok(
      {}, 
      { 
        title: 'Success', 
        description: 'The operation completed successfully.' 
      }, 
      { requestId: correlationId, event }
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/user', 404, duration, correlationId);
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'USER_NOT_FOUND', details: [{ message: err.message }] },
      );
    }
    logger.error({ event: 'updateUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/user', 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'USER.UPDATE_USER_FAILED',
      { requestId: correlationId, event },
      { code: 'UPDATE_USER_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
}

export async function deleteUser(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const userId = event.pathParameters?.userId;
  const organizationIdFromPath = event.pathParameters?.organizationId;
  const authorizer = (event.requestContext as any)?.authorizer;
  const organizationId =
    organizationIdFromPath ||
    (event as any).organizationId ||
    (event as any).organizationID ||
    authorizer?.organizationID ||
    authorizer?.organizationId;

  if (!userId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/users/${userId}`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'userId is required' }] },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deleteUser_received', eventData: event });

  try {
    if (!organizationId) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/users/${userId}`, 400, duration, correlationId);
      return ApiResponse.badRequest(
        'COMMON.BAD_REQUEST',
        { requestId: correlationId, event },
        { code: 'BAD_REQUEST', details: [{ message: 'organizationId is required' }] },
      );
    }
    await userService.deleteUser(userId, organizationId, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/users/${userId}`, 200, duration, correlationId);
    return ApiResponse.ok(null, 'USER.USER_DELETED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/users/${userId}`, 404, duration, correlationId);
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'USER_NOT_FOUND', details: [{ message: err.message }] },
      );
    }
    logger.error({ event: 'deleteUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/users/${userId}`, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'USER.DELETE_USER_FAILED',
      { requestId: correlationId, event },
      { code: 'DELETE_USER_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
}

export async function assignUserToOrganization(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  
  logger.info({ event: 'assignUserToOrg_received', eventData: event });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'assignUserToOrg_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] },
    );
  }

  const validation = assignUserToOrganizationSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'assignUserToOrg_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 400, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    );
  }

  try {
    await userService.assignUserToOrganization(validation.data.userId, validation.data.organizationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 200, duration, correlationId);
    return ApiResponse.ok(null, 'USER.USER_ASSIGNED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 404, duration, correlationId);
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'USER_NOT_FOUND', details: [{ message: err.message }] },
      );
    }
    logger.error({ event: 'assignUserToOrg_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'USER.ASSIGN_USER_FAILED',
      { requestId: correlationId, event },
      { code: 'ASSIGN_USER_ORG_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
}

const PATH_ASSIGN_DOCTOR = '/user/assign-doctor';
const PATH_DOCTOR_PATIENT_LIST = '/user/doctor-patient-list';

export async function assignDoctor(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'assignDoctor_received' });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'assignDoctor_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_ASSIGN_DOCTOR, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] },
    );
  }

  const validation = assignDoctorSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'assignDoctor_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_ASSIGN_DOCTOR, 400, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e) => ({
          field: e.path.map(String).join('.'),
          message: e.message,
        })),
      },
    );
  }

  const { organizationId, sender, receiver } = validation.data;
  try {
    await userService.assignDoctor(organizationId, sender, receiver, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_ASSIGN_DOCTOR, 200, duration, correlationId);
    return ApiResponse.ok(
      { message: 'Patient assigned to doctor successfully!' },
      'USER.ASSIGN_DOCTOR_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_ASSIGN_DOCTOR, 404, duration, correlationId);
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'USER_NOT_FOUND', details: [{ message: (err as Error).message }] },
      );
    }
    if ((err as Error)?.message === 'DOCTOR_NOT_LINKED_WITH_USER') {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_ASSIGN_DOCTOR, 502, duration, correlationId);
      return ApiResponse.badRequest(
        'USER.DOCTOR_NOT_LINKED',
        { requestId: correlationId, event },
        { code: 'DOCTOR_NOT_LINKED_WITH_USER' },
      );
    }
    logger.error({ event: 'assignDoctor_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_ASSIGN_DOCTOR, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'USER.ASSIGN_DOCTOR_FAILED',
      { requestId: correlationId, event },
      { code: 'ASSIGN_DOCTOR_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
}

export async function listDoctorPatients(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'listDoctorPatients_received' });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'listDoctorPatients_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_DOCTOR_PATIENT_LIST, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] },
    );
  }

  const validation = listDoctorPatientsSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'listDoctorPatients_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_DOCTOR_PATIENT_LIST, 400, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e) => ({
          field: e.path.map(String).join('.'),
          message: e.message,
        })),
      },
    );
  }

  const { organizationId, doctorId } = validation.data;
  try {
    const users = await userService.listDoctorPatients(doctorId, organizationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_DOCTOR_PATIENT_LIST, 200, duration, correlationId);
    return ApiResponse.ok(
      { users },
      'USER.LIST_DOCTOR_PATIENTS_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'listDoctorPatients_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_DOCTOR_PATIENT_LIST, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'USER.LIST_DOCTOR_PATIENTS_FAILED',
      { requestId: correlationId, event },
      { code: 'LIST_DOCTOR_PATIENTS_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
}

const PATH_FNF_SEARCH = '/user/friend-family/search';
const PATH_FNF_ADD = '/user/friend-family/add-member';
const PATH_FNF_UPDATE = '/user/friend-family/update';
const PATH_FNF_FETCH = '/user/friend-family/fetch';
const PATH_FNF_DELETE = '/user/friend-family/delete';

function getAuthorizerUserId(event: APIGatewayProxyEvent): string | undefined {
  const authorizer = (event.requestContext as any)?.authorizer;
  return (authorizer?.userID ?? authorizer?.userId ?? authorizer?.['custom:userID']) as string | undefined;
}

function getAuthorizerOrganizationId(event: APIGatewayProxyEvent): string | undefined {
  const authorizer = (event.requestContext as any)?.authorizer;
  return (authorizer?.organizationID ?? authorizer?.organizationId ?? authorizer?.['custom:organizationID']) as string | undefined;
}

export async function friendFamilySearch(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  const authHeader = event.headers?.Authorization ?? event.headers?.authorization;

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  const b = body as Record<string, unknown>;
  const userID = (b.userID as string) ?? getAuthorizerUserId(event);
  const organizationID = (b.organizationID as string) ?? getAuthorizerOrganizationId(event);
  const validation = friendFamilySearchSchema.safeParse({ ...b, organizationID });
  if (!validation.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 400, duration, correlationId);
    return ApiResponse.unprocessableEntity('COMMON.VALIDATION_ERROR', { requestId: correlationId, event }, {
      code: 'VALIDATION_ERROR',
      details: validation.error.issues.map((e) => ({ field: e.path.map(String).join('.'), message: e.message })),
    });
  }
  if (!userID || !organizationID?.trim()) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 401, duration, correlationId);
    return ApiResponse.unauthorized('COMMON.UNAUTHORIZED', { requestId: correlationId, event }, { code: 'UNAUTHORIZED' });
  }

  try {
    const result = await friendFamilyService.searchFnf(organizationID, userID, validation.data, authHeader);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_SEARCH, 200, duration, correlationId);
    if (result.success && result.invitedUser) {
      return ApiResponse.ok(
        { invitedUser: result.invitedUser, ...(result.data && { data: result.data }) },
        'FRIEND_FAMILY.SEARCH_SUCCESS',
        { requestId: correlationId, event },
      );
    }
    return ApiResponse.ok(
      { message: 'User not found; invite via create user with friendNFamily' },
      'FRIEND_FAMILY.USER_NOT_FOUND',
      { requestId: correlationId, event },
    );
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

export async function friendFamilyAddMember(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  const authHeader = event.headers?.Authorization ?? event.headers?.authorization;

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  const b = body as Record<string, unknown>;
  const userIdFromAuth = getAuthorizerUserId(event);
  const userId = (b.userId as string) ?? (b.userID as string) ?? userIdFromAuth;
  const organizationID = (b.organizationID as string) ?? getAuthorizerOrganizationId(event);
  const payload = { ...b, userId, organizationID } as Record<string, unknown>;
  const validation = addMemberFriendFamilySchema.safeParse(payload);
  if (!validation.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 400, duration, correlationId);
    return ApiResponse.unprocessableEntity('COMMON.VALIDATION_ERROR', { requestId: correlationId, event }, {
      code: 'VALIDATION_ERROR',
      details: validation.error.issues.map((e) => ({ field: e.path.map(String).join('.'), message: e.message })),
    });
  }
  if (!userId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 401, duration, correlationId);
    return ApiResponse.unauthorized('COMMON.UNAUTHORIZED', { requestId: correlationId, event }, { code: 'UNAUTHORIZED' });
  }
  const orgId = validation.data.organizationID ?? organizationID;
  if (!orgId || !orgId.trim()) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 401, duration, correlationId);
    return ApiResponse.unauthorized('COMMON.UNAUTHORIZED', { requestId: correlationId, event }, { code: 'UNAUTHORIZED' });
  }

  try {
    const { organizationID: _omit, ...addBody } = validation.data;
    const data = await friendFamilyService.addMember(orgId, { ...addBody, userId }, authHeader);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 200, duration, correlationId);
    return ApiResponse.ok(data, 'FRIEND_FAMILY.ADD_MEMBER_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 404, duration, correlationId);
      return ApiResponse.notFound('USER.USER_NOT_FOUND', { requestId: correlationId, event }, { code: 'USER_NOT_FOUND', details: [{ message: (err as Error).message }] });
    }
    const msg = (err as Error)?.message;
    if (['ORGANIZATION_NOT_EXIST', 'ORGANIZATION_IS_ON_HOLD', 'ORGANIZATION_MISMATCH'].includes(msg ?? '')) {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 400, duration, correlationId);
      return ApiResponse.badRequest(`FRIEND_FAMILY.${msg}`, { requestId: correlationId, event }, { code: msg! });
    }
    logger.error({ event: 'friendFamilyAddMember_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 500, duration, correlationId);
    return ApiResponse.internalServerError('FRIEND_FAMILY.INTERNAL_SERVER_ERROR', { requestId: correlationId, event }, { code: 'INTERNAL_SERVER_ERROR' });
  }
}

export async function friendFamilyUpdate(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_UPDATE, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  const b = body as Record<string, unknown>;
  const userId = (b.userId as string) ?? (b.userID as string) ?? getAuthorizerUserId(event);
  const organizationID = (b.organizationID as string) ?? getAuthorizerOrganizationId(event);
  const validation = updateFriendFamilySchema.safeParse({ ...b, organizationID });
  if (!validation.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_UPDATE, 400, duration, correlationId);
    return ApiResponse.unprocessableEntity('COMMON.VALIDATION_ERROR', { requestId: correlationId, event }, {
      code: 'VALIDATION_ERROR',
      details: validation.error.issues.map((e) => ({ field: e.path.map(String).join('.'), message: e.message })),
    });
  }
  if (!userId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_UPDATE, 401, duration, correlationId);
    return ApiResponse.unauthorized('COMMON.UNAUTHORIZED', { requestId: correlationId, event }, { code: 'UNAUTHORIZED' });
  }
  const orgId = validation.data.organizationID ?? organizationID;
  if (!orgId?.trim()) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_UPDATE, 401, duration, correlationId);
    return ApiResponse.unauthorized('COMMON.UNAUTHORIZED', { requestId: correlationId, event }, { code: 'UNAUTHORIZED' });
  }

  try {
    await friendFamilyService.updateMember(userId, orgId, validation.data);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_UPDATE, 200, duration, correlationId);
    return ApiResponse.ok(null, 'FRIEND_FAMILY.UPDATE_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if ((err as Error)?.message === 'MEMBER_NOT_FOUND') {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_UPDATE, 400, duration, correlationId);
      return ApiResponse.badRequest('FRIEND_FAMILY.MEMBER_NOT_FOUND', { requestId: correlationId, event }, { code: 'MEMBER_NOT_FOUND' });
    }
    logger.error({ event: 'friendFamilyUpdate_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_UPDATE, 500, duration, correlationId);
    return ApiResponse.internalServerError('FRIEND_FAMILY.INTERNAL_SERVER_ERROR', { requestId: correlationId, event }, { code: 'INTERNAL_SERVER_ERROR' });
  }
}

export async function friendFamilyFetch(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body ?? {};
  } catch (err) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_FETCH, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  const b = (body as Record<string, unknown>) ?? {};
  const userId = (b.userId as string) ?? (b.userID as string) ?? getAuthorizerUserId(event);
  const validation = fetchFriendFamilySchema.safeParse({ userId: userId ?? '' });
  if (!validation.success || !userId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_FETCH, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.BAD_REQUEST', { requestId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'userId is required' }] });
  }

  try {
    const data = await friendFamilyService.fetchMembers(userId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_FETCH, 200, duration, correlationId);
    return ApiResponse.ok(data, 'FRIEND_FAMILY.FETCH_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'friendFamilyFetch_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_FETCH, 500, duration, correlationId);
    return ApiResponse.internalServerError('FRIEND_FAMILY.INTERNAL_SERVER_ERROR', { requestId: correlationId, event }, { code: 'INTERNAL_SERVER_ERROR' });
  }
}

export async function friendFamilyDelete(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_DELETE, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  const validation = deleteFriendFamilySchema.safeParse(body);
  if (!validation.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_DELETE, 400, duration, correlationId);
    return ApiResponse.unprocessableEntity('COMMON.VALIDATION_ERROR', { requestId: correlationId, event }, {
      code: 'VALIDATION_ERROR',
      details: validation.error.issues.map((e) => ({ field: e.path.map(String).join('.'), message: e.message })),
    });
  }

  const { userID, memberID, organizationID } = validation.data;
  try {
    await friendFamilyService.deleteMember(userID, memberID, organizationID);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_DELETE, 201, duration, correlationId);
    return ApiResponse.created({ userID, memberID, organizationID: organizationID ?? null }, 'FRIEND_FAMILY.DELETE_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if ((err as Error)?.message === 'FNF_DOES_NOT_EXIST') {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_DELETE, 400, duration, correlationId);
      return ApiResponse.badRequest('FRIEND_FAMILY.FNF_DOES_NOT_EXIST', { requestId: correlationId, event }, { code: 'FNF_DOES_NOT_EXIST' });
    }
    logger.error({ event: 'friendFamilyDelete_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_DELETE, 500, duration, correlationId);
    return ApiResponse.internalServerError('FRIEND_FAMILY.INTERNAL_SERVER_ERROR', { requestId: correlationId, event }, { code: 'INTERNAL_SERVER_ERROR' });
  }
}

export async function listUserOrganizations(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const userId = event.pathParameters?.userId;

  if (!userId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/organizations`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'userId is required' }] },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'listUserOrgs_received', eventData: event });

  try {
    const result = await userService.listUserOrganizations(userId);
    const duration = Date.now() - startTime;
    logger.info({ event: 'listUserOrgs_success', count: result.length });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/organizations`, 200, duration, correlationId);
    return ApiResponse.ok(result, 'USER.LIST_ORGANIZATIONS_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/organizations`, 404, duration, correlationId);
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'USER_NOT_FOUND', details: [{ message: err.message }] },
      );
    }
    logger.error({ event: 'listUserOrgs_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/organizations`, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'USER.LIST_ORGANIZATIONS_FAILED',
      { requestId: correlationId, event },
      { code: 'LIST_USER_ORGS_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
}

export async function updateUserMetadata(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const userId = event.pathParameters?.userId;

  if (!userId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}/metadata`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'userId is required' }] },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'updateUserMetadata_received', eventData: event });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'updateUserMetadata_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}/metadata`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] },
    );
  }

  const validation = updateUserMetadataSchema.safeParse({ ...(body as Record<string, unknown>), userId });
  if (!validation.success) {
    logger.warn({ event: 'updateUserMetadata_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}/metadata`, 400, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    );
  }

  try {
    const result = await userService.updateUserMetadata(userId, validation.data.metadata);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}/metadata`, 200, duration, correlationId);
    return ApiResponse.ok(result, 'USER.METADATA_UPDATED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}/metadata`, 404, duration, correlationId);
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'USER_NOT_FOUND', details: [{ message: err.message }] },
      );
    }
    logger.error({ event: 'updateUserMetadata_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}/metadata`, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'USER.UPDATE_METADATA_FAILED',
      { requestId: correlationId, event },
      { code: 'UPDATE_USER_METADATA_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
}

export async function listUserFiles(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const userId = event.pathParameters?.userId;

  if (!userId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/files`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'userId is required' }] },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'listUserFiles_received', eventData: event });

  try {
    const result = await userService.listUserFiles(userId);
    const duration = Date.now() - startTime;
    logger.info({ event: 'listUserFiles_success', count: result.length });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/files`, 200, duration, correlationId);
    return ApiResponse.ok(result, 'USER.LIST_FILES_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/files`, 404, duration, correlationId);
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'USER_NOT_FOUND', details: [{ message: err.message }] },
      );
    }
    logger.error({ event: 'listUserFiles_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/files`, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'USER.LIST_FILES_FAILED',
      { requestId: correlationId, event },
      { code: 'LIST_USER_FILES_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
}

export async function listOrganizationUsers(
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const organizationId = event.pathParameters?.organizationId;

  if (!organizationId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
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
      { code: 'BAD_REQUEST', details: [{ message: 'organizationId is required' }] },
    );
  }

  const logger = createChildLogger(baseLogger, {
    correlationId,
    organizationId,
    ...(awsRequestId && { awsRequestId }),
  });
  logger.info({ event: 'listOrganizationUsers_received', eventData: event });

  // Extract and validate query params for pagination / filtering / sorting / search
  const qp = event.queryStringParameters || {};

  const rawLimit = qp.limit ?? qp.pageSize;
  const rawOffset = qp.offset ?? qp.page ?? qp.pageIndex;
  const rawStatus = qp.status;
  const rawUserType = qp.userType;
  const rawSearch = qp.search ?? qp.q;
  const rawSortBy = qp.sortBy;
  const rawSortOrder = qp.sortOrder ?? qp.order;

  let limit: number | undefined;
  let offset = 0;
  let sortBy: 'createdDate' | 'fullName' | 'firstName' | 'lastName' | 'emailAddress' | undefined;
  let sortOrder: 'asc' | 'desc' | undefined;

  const MAX_LIMIT = 100;

  const parseNumber = (value?: string | null): number | undefined => {
    if (!value) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };

  // limit
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

  // offset (supports both absolute offset and simple page index)
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
          details: [{ message: 'offset / page must be a non-negative number' }],
        },
      );
    }
    offset = parsed;
  }

  // sortBy
  if (rawSortBy) {
    const allowedSortBy = ['createdDate', 'fullName', 'firstName', 'lastName', 'emailAddress'] as const;
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
          details: [{ message: `sortBy must be one of ${allowedSortBy.join(', ')}` }],
        },
      );
    }
    sortBy = rawSortBy as any;
  }

  // sortOrder
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
          details: [{ message: 'sortOrder must be "asc" or "desc"' }],
        },
      );
    }
    sortOrder = normalized as any;
  }

  try {
    const result = await userService.listOrganizationUsers(organizationId, {
      limit,
      offset,
      status: rawStatus || undefined,
      userType: rawUserType || undefined,
      search: rawSearch || undefined,
      sortBy,
      sortOrder,
    });
    const duration = Date.now() - startTime;
    logger.info({ event: 'listOrganizationUsers_success', count: result.length });
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || `/organization/${organizationId}/users`,
      200,
      duration,
      correlationId,
    );
    return ApiResponse.ok(result, 'ORGANIZATION.LIST_USERS_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'listOrganizationUsers_error', err: serializeError(err) });
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
      { code: 'LIST_ORG_USERS_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
}



