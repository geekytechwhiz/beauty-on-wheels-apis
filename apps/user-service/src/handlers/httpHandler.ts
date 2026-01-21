import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { UserService } from '../services/user.service';
import { assignUserRole, getRoleDetails } from '../services/role.service';
import { createLogger, extractCorrelationId, serializeError, logHttpRequest, extractAwsRequestId, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import {
  createUserSchema,
  updateUserSchema,
  assignUserToOrganizationSchema,
  updateUserMetadataSchema,
} from '../validation/user.validation';
import { UserNotFoundError, UserAlreadyExistsError } from '../utils/errors';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

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
    const roleIds = Array.isArray(userRole)
      ? userRole.map((roleId) => String(roleId))
      : userRole
        ? [String(userRole)]
        : [];
    const authHeader =
      event.headers?.Authorization ||
      event.headers?.authorization ||
      event.headers?.AUTHORIZATION;
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
    if (roleIds.length > 0) {
      logger.info({
        event: 'createUser_role_check_start',
        organizationID: body.organizationID,
        roleIds,
      });
      const roleMetas = await Promise.all(
        roleIds.map(async (roleId: string) => {
          const roleMeta = await getRoleDetails(roleId, body.organizationID, authHeader);
          if (!roleMeta || (Array.isArray(roleMeta) && roleMeta.length === 0)) {
            logger.warn({ event: 'createUser_role_not_found', roleId, organizationID: body.organizationID });
          } else {
            logger.info({
              event: 'createUser_role_check_success',
              roleId,
              organizationID: body.organizationID,
            });
          }
          logger.info({ event: 'createUser_role_check_success', roleMeta });
          return roleMeta;
        }),
      );
      const metaWithRoleCode = roleMetas.find((meta) => {
        if (!meta) return false;
        if (Array.isArray(meta)) {
          return meta.some((item) => (item as any)?.definedRoleCode);
        }
        return (meta as any)?.definedRoleCode;
      });
      if (metaWithRoleCode) {
        definedRoleCode = Array.isArray(metaWithRoleCode)
          ? (metaWithRoleCode.find((item) => (item as any)?.definedRoleCode) as any)?.definedRoleCode
          : (metaWithRoleCode as any)?.definedRoleCode;
      }
    } else {
      logger.warn({
        event: 'createUser_role_missing',
        organizationID: body.organizationID,
        userType: userTypeUpper,
      });
    }
    logger.info({ event: 'createUser_definedRoleCode', definedRoleCode });
    if (definedRoleCode) {
      userData.definedRoleCode = definedRoleCode;
    }

    const result = await userService.createUser(
      userData,
      body.organizationID,
      body.userID,
      correlationId,
      authHeader,
      body?.userInfo?.friendNFamily,
    );

    if (roleIds.length > 0) {
      logger.info({
        event: 'createUser_assign_user_role_start',
        organizationID: body.organizationID,
        userID: result.userID,
        roleId: roleIds[0],
      });
      void assignUserRole(
        roleIds[0],
        body.organizationID,
        result.userID,
        userInfo.name,
        userInfo.contact.email ?? undefined,
        userInfo.contact.phone ?? undefined,
        userInfo.profilePic,
        authHeader,
      ).catch((err) => {
        logger.warn({ event: 'createUser_assign_user_role_failed', err: serializeError(err) });
      });
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
      { userID: result.userID },
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
  const userId = event.pathParameters?.userId;
  const organizationId = event.pathParameters?.organizationId;

  if (!userId || !organizationId) {
    const duration = Date.now() - startTime;
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'userId is required' }] },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, organizationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'getUser_received', eventData: event });

  try {
    const result = await userService.getUser(userId,organizationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 200, duration, correlationId);
    return ApiResponse.ok(result, 'USER.USER_RETRIEVED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 404, duration, correlationId);
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'USER_NOT_FOUND', details: [{ message: err.message }] },
      );
    }
    logger.error({ event: 'getUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 500, duration, correlationId);
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
  
  // Extract userId and organizationId from access token (authorizer)
  const authorizer = (event.requestContext as any)?.authorizer;
  
  let userId = authorizer?.userID || authorizer?.userId || (event as any).userID || (event as any).userId;
  let organizationId = authorizer?.organizationID || authorizer?.organizationId || (event as any).organizationID || (event as any).organizationId;
  
  // Fallback: Try to decode JWT token from Authorization header if authorizer is not available
  if ((!userId || !organizationId) && event.headers?.Authorization) {
    try {
      const authHeader = event.headers.Authorization || event.headers.authorization;
      if (authHeader && typeof authHeader === 'string') {
        const token = authHeader.replace('Bearer ', '').trim();
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
          userId = userId || decoded['custom:userID'] || decoded['custom:userId'] || decoded.userID || decoded.userId || decoded.sub;
          organizationId = organizationId || decoded['custom:organizationID'] || decoded['custom:organizationId'] || decoded.organizationID || decoded.organizationId;
        }
      }
    } catch (err) {
      console.log("Error decoding token: ", err);
      // Continue without token decoding
    }
  }

  console.log("USER ID ", userId);
  console.log("ORGANIZATION ID ", organizationId);

  if (!userId || !organizationId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/user', 401, duration, correlationId);
    return ApiResponse.unauthorized(
      'COMMON.UNAUTHORIZED',
      { requestId: correlationId, event },
      { code: 'UNAUTHORIZED', details: [{ message: 'Missing user context in access token' }] },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'updateUser_received', eventData: event });

  let body: any;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'updateUser_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] },
    );
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
    if (data.licenseNumber !== undefined) userData.licenseNumber = data.licenseNumber;
    
    // Map contact fields
    if (data.email !== undefined) userData.emailAddress = data.email;
    if (data.phone !== undefined) userData.phoneNumber = data.phone;
    if (data.phoneCode !== undefined) userData.phoneCode = data.phoneCode;
    
    // Map name fields - combine firstName and lastName into fullName
    if (data.firstName !== undefined || data.lastName !== undefined) {
      const firstName = data.firstName ?? '';
      const lastName = data.lastName ?? '';
      userData.firstName = firstName;
      userData.lastName = lastName;
      userData.fullName = `${firstName} ${lastName}`.trim();
    }
    
    // Update srcRegisEntity if email or phone is being updated
    if (data.email !== undefined || data.phone !== undefined) {
      const isEmail = data.email && data.email.includes('@');
      userData.srcRegisEntity = isEmail ? 'email' : 'phone_number';
    }
    
    // Note: 'action' field is accepted but not stored in user data (may be used for business logic)
    
    const result = await userService.updateUser(userId, organizationId, userData, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/user', 200, duration, correlationId);
    return ApiResponse.ok(result, 'USER.USER_UPDATED_SUCCESS', { requestId: correlationId, event });
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
    await userService.deleteUser(userId, correlationId);
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

  try {
    const result = await userService.listOrganizationUsers(organizationId);
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


