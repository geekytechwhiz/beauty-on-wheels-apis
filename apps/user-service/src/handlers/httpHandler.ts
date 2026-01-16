import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { UserService } from '../services/user.service';
import { assignUserRole, getRoleDetails } from '../services/role.service';
import { createLogger, extractCorrelationId, serializeError, logHttpRequest, extractAwsRequestId, createChildLogger } from '@api-hub/logger';
import {
  ok,
  created,
  badRequest,
  notFound,
  conflict,
  unprocessableEntity,
  internalServerError,
} from '@api-hub/utils';
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
    return badRequest(
      {
        title: 'Invalid request',
        description: 'Invalid JSON body',
        severity: 'error',
      },
      [{ code: 'BAD_REQUEST', message: 'Invalid JSON body' }],
      { correlationId },
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
    return unprocessableEntity(
      {
        title: 'Validation failed',
        description: 'Invalid request data',
        severity: 'error',
      },
      validation.error.issues.map((e: any) => ({
        field: e.path.join('.'),
        message: e.message,
        code: 'VALIDATION_ERROR',
      })),
      { correlationId },
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
    if (roleIds.length > 0) {
      await Promise.all(
        roleIds.map(async (roleId: string) => {
          const roleMeta = await getRoleDetails(roleId, body.organizationID, authHeader);
          if (!roleMeta || (Array.isArray(roleMeta) && roleMeta.length === 0)) {
            logger.warn({ event: 'createUser_role_not_found', roleId, organizationID: body.organizationID });
          }
        }),
      );
    } else {
      logger.warn({ event: 'createUser_role_missing', organizationID: body.organizationID });
    }

    const result = await userService.createUser(userData, body.organizationID, body.userID, correlationId);

    if (roleIds.length > 0) {
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
    }
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users', 201, duration, correlationId);
    
    return created(
      { userID: result.userID },
      'User created successfully',
      { requestId: correlationId },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserAlreadyExistsError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users', 409, duration, correlationId);
      return conflict(
        {
          title: 'User already exists',
          description: err.message,
          severity: 'error',
        },
        [{ code: 'USER_ALREADY_EXISTS', message: err.message }],
        { correlationId },
      );
    }
    logger.error({ event: 'createUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users', 500, duration, correlationId);
    return internalServerError(
      {
        title: 'Failed to create user',
        description: (err as Error)?.message || 'Unknown error',
        severity: 'error',
      },
      [{ code: 'CREATE_USER_FAILED', message: (err as Error)?.message || 'Unknown error' }],
      { correlationId },
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
    return badRequest(
      { 
        title: 'Invalid request',
        description: 'userId is required',
        severity: 'error',
      },
      [{ code: 'BAD_REQUEST', message: 'userId is required' }],
      { correlationId },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, organizationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'getUser_received', eventData: event });

  try {
    const result = await userService.getUser(userId,organizationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 200, duration, correlationId);
    return ok(result, 'User retrieved successfully', { requestId: correlationId });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 404, duration, correlationId);
      return notFound(
        {
          title: 'User not found',
          description: err.message,
          severity: 'error',
        },
        [{ code: 'USER_NOT_FOUND', message: err.message }],
        { correlationId },
      );
    }
    logger.error({ event: 'getUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 500, duration, correlationId);
    return internalServerError(
      {
        title: 'Failed to get user',
        description: (err as Error)?.message || 'Unknown error',
        severity: 'error',
      },
      [{ code: 'GET_USER_FAILED', message: (err as Error)?.message || 'Unknown error' }],
      { correlationId },
    );
  }
}

export async function updateUser(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const userId = event.pathParameters?.userId;
  const organizationId = event.pathParameters?.organizationId;

  if (!userId || !organizationId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/organization/${organizationId}/${userId}`, 400, duration, correlationId);
    return badRequest(
      {
        title: 'Invalid request',
        description: 'userId and organizationId are required',
        severity: 'error',
      },
      [{ code: 'BAD_REQUEST', message: 'userId and organizationId are required' }],
      { correlationId },
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
    return badRequest(
      {
        title: 'Invalid request',
        description: 'Invalid JSON body',
        severity: 'error',
      },
      [{ code: 'BAD_REQUEST', message: 'Invalid JSON body' }],
      { correlationId },
    );
  }

  const validation = updateUserSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'updateUser_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}`, 400, duration, correlationId);
    return unprocessableEntity(
      {
        title: 'Validation failed',
        description: 'Invalid request data',
        severity: 'error',
      },
      validation.error.issues.map((e: any) => ({
        field: e.path.join('.'),
        message: e.message,
        code: 'VALIDATION_ERROR',
      })),
      { correlationId },
    );
  }

  try {
    const { userInfo, userRole, userType } = validation.data;
    
    // Build update data object - only include fields that are provided
    const userData: any = {};
    
    if (userInfo) {
      const contactAddress = (userInfo.contact as any)?.address;
      
      if (userInfo.name !== undefined) userData.fullName = userInfo.name;
      if (userInfo.namePrefix !== undefined) userData.namePrefix = userInfo.namePrefix;
      if (userInfo.profilePic !== undefined) userData.profilePic = userInfo.profilePic;
      if (userInfo.code !== undefined) userData.code = userInfo.code;
      if (userInfo.licenseNumber !== undefined) userData.licenseNumber = userInfo.licenseNumber;
      
      if (userInfo.contact) {
        if (userInfo.contact.email !== undefined) userData.emailAddress = userInfo.contact.email;
        if (userInfo.contact.phone !== undefined) userData.phoneNumber = userInfo.contact.phone;
        if (userInfo.contact.phoneCode !== undefined) userData.phoneCode = userInfo.contact.phoneCode;
      }
      
      if (userInfo.workingHours !== undefined) userData.workingHours = userInfo.workingHours;
      if (userInfo.dateOfBirth !== undefined) userData.dateOfBirth = userInfo.dateOfBirth;
      if (userInfo.department !== undefined) userData.department = userInfo.department;
      if (userInfo.gender !== undefined) userData.gender = userInfo.gender;
      if (userInfo.specialty !== undefined) userData.specialty = userInfo.specialty;
      if (userInfo.slotDurationInMinutes !== undefined) userData.slotDurationInMinutes = userInfo.slotDurationInMinutes;
      if (userInfo.experienceInYears !== undefined) userData.experienceInYears = userInfo.experienceInYears;
      if (userInfo.bio !== undefined) userData.bio = userInfo.bio;
      
      if (contactAddress) {
        if (contactAddress.address !== undefined) userData.address = contactAddress.address || userInfo.address || '';
        if (contactAddress.city !== undefined) userData.city = contactAddress.city || userInfo.city || '';
        if (contactAddress.state !== undefined) userData.state = contactAddress.state || userInfo.state || '';
        if (contactAddress.country !== undefined) userData.country = contactAddress.country || userInfo.country || '';
        if (contactAddress.postalCode !== undefined) userData.postalCode = contactAddress.postalCode || userInfo.postalCode || '';
        if (contactAddress.street !== undefined) userData.street = contactAddress.street || '';
        if (contactAddress.zip !== undefined) userData.zip = contactAddress.zip || '';
        if (contactAddress.countryCode !== undefined) userData.countryCode = contactAddress.countryCode || '';
        if (contactAddress.stateCode !== undefined) userData.stateCode = contactAddress.stateCode || '';
      } else {
        if (userInfo.address !== undefined) userData.address = userInfo.address;
        if (userInfo.city !== undefined) userData.city = userInfo.city;
        if (userInfo.state !== undefined) userData.state = userInfo.state;
        if (userInfo.country !== undefined) userData.country = userInfo.country;
        if (userInfo.postalCode !== undefined) userData.postalCode = userInfo.postalCode;
      }
      
      if (userInfo.emergencyContact !== undefined) userData.emergencyContact = userInfo.emergencyContact;
      if (userInfo.medicalHistory !== undefined) userData.medicalHistory = userInfo.medicalHistory;
      if (userInfo.insuranceDetails !== undefined) userData.insuranceDetails = userInfo.insuranceDetails;
      if (userInfo.workSchedule !== undefined) userData.workSchedule = userInfo.workSchedule;
      if (userInfo.position !== undefined) userData.position = userInfo.position;
      if (userInfo.userTimeZone !== undefined) userData.userTimeZone = userInfo.userTimeZone;
      if (userInfo.devices !== undefined) userData.devices = userInfo.devices;
      if (userInfo.assignRoomNo !== undefined) userData.assignRoomNo = userInfo.assignRoomNo;
      if (userInfo.username !== undefined) userData.username = userInfo.username;
      
      // Update srcRegisEntity if email or phone is being updated
      if (userInfo.contact?.email !== undefined || userInfo.contact?.phone !== undefined) {
        const isEmail = userInfo.contact?.email && userInfo.contact.email.includes('@');
        userData.srcRegisEntity = isEmail ? 'email' : 'phone_number';
      }
    }
    
    if (userRole !== undefined) userData.userRole = userRole;
    if (userType !== undefined) userData.userType = userType;
    
    const result = await userService.updateUser(userId, organizationId, userData, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}`, 200, duration, correlationId);
    return ok(result, 'User updated', { requestId: correlationId });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}`, 404, duration, correlationId);
      return notFound(
        {
          title: 'User not found',
          description: err.message,
          severity: 'error',
        },
        [{ code: 'USER_NOT_FOUND', message: err.message }],
        { correlationId },
      );
    }
    logger.error({ event: 'updateUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}`, 500, duration, correlationId);
    return internalServerError(
      {
        title: 'Failed to update user',
        description: (err as Error)?.message || 'Unknown error',
        severity: 'error',
      },
      [{ code: 'UPDATE_USER_FAILED', message: (err as Error)?.message || 'Unknown error' }],
      { correlationId },
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
    return badRequest(
      {
        title: 'Invalid request',
        description: 'userId is required',
        severity: 'error',
      },
      [{ code: 'BAD_REQUEST', message: 'userId is required' }],
      { correlationId },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deleteUser_received', eventData: event });

  try {
    await userService.deleteUser(userId, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/users/${userId}`, 200, duration, correlationId);
    return ok(null, 'User deleted', { requestId: correlationId });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/users/${userId}`, 404, duration, correlationId);
      return notFound(
        {
          title: 'User not found',
          description: err.message,
          severity: 'error',
        },
        [{ code: 'USER_NOT_FOUND', message: err.message }],
        { correlationId },
      );
    }
    logger.error({ event: 'deleteUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/users/${userId}`, 500, duration, correlationId);
    return internalServerError(
      {
        title: 'Failed to delete user',
        description: (err as Error)?.message || 'Unknown error',
        severity: 'error',
      },
      [{ code: 'DELETE_USER_FAILED', message: (err as Error)?.message || 'Unknown error' }],
      { correlationId },
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
    return badRequest(
      {
        title: 'Invalid request',
        description: 'Invalid JSON body',
        severity: 'error',
      },
      [{ code: 'BAD_REQUEST', message: 'Invalid JSON body' }],
      { correlationId },
    );
  }

  const validation = assignUserToOrganizationSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'assignUserToOrg_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 400, duration, correlationId);
    return unprocessableEntity(
      {
        title: 'Validation failed',
        description: 'Invalid request data',
        severity: 'error',
      },
      validation.error.issues.map((e: any) => ({
        field: e.path.join('.'),
        message: e.message,
        code: 'VALIDATION_ERROR',
      })),
      { correlationId },
    );
  }

  try {
    await userService.assignUserToOrganization(validation.data.userId, validation.data.organizationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 200, duration, correlationId);
    return ok(null, 'User assigned to organization', { requestId: correlationId });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 404, duration, correlationId);
      return notFound(
        {
          title: 'User not found',
          description: err.message,
          severity: 'error',
        },
        [{ code: 'USER_NOT_FOUND', message: err.message }],
        { correlationId },
      );
    }
    logger.error({ event: 'assignUserToOrg_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 500, duration, correlationId);
    return internalServerError(
      {
        title: 'Failed to assign user to organization',
        description: (err as Error)?.message || 'Unknown error',
        severity: 'error',
      },
      [{ code: 'ASSIGN_USER_ORG_FAILED', message: (err as Error)?.message || 'Unknown error' }],
      { correlationId },
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
    return badRequest(
      {
        title: 'Invalid request',
        description: 'userId is required',
        severity: 'error',
      },
      [{ code: 'BAD_REQUEST', message: 'userId is required' }],
      { correlationId },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'listUserOrgs_received', eventData: event });

  try {
    const result = await userService.listUserOrganizations(userId);
    const duration = Date.now() - startTime;
    logger.info({ event: 'listUserOrgs_success', count: result.length });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/organizations`, 200, duration, correlationId);
    return ok(result, 'User organizations retrieved successfully', { requestId: correlationId });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/organizations`, 404, duration, correlationId);
      return notFound(
        {
          title: 'User not found',
          description: err.message,
          severity: 'error',
        },
        [{ code: 'USER_NOT_FOUND', message: err.message }],
        { correlationId },
      );
    }
    logger.error({ event: 'listUserOrgs_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/organizations`, 500, duration, correlationId);
    return internalServerError(
      {
        title: 'Failed to list user organizations',
        description: (err as Error)?.message || 'Unknown error',
        severity: 'error',
      },
      [{ code: 'LIST_USER_ORGS_FAILED', message: (err as Error)?.message || 'Unknown error' }],
      { correlationId },
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
    return badRequest(
      {
        title: 'Invalid request',
        description: 'userId is required',
        severity: 'error',
      },
      [{ code: 'BAD_REQUEST', message: 'userId is required' }],
      { correlationId },
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
    return badRequest(
      {
        title: 'Invalid request',
        description: 'Invalid JSON body',
        severity: 'error',
      },
      [{ code: 'BAD_REQUEST', message: 'Invalid JSON body' }],
      { correlationId },
    );
  }

  const validation = updateUserMetadataSchema.safeParse({ ...(body as Record<string, unknown>), userId });
  if (!validation.success) {
    logger.warn({ event: 'updateUserMetadata_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}/metadata`, 400, duration, correlationId);
    return unprocessableEntity(
      {
        title: 'Validation failed',
        description: 'Invalid request data',
        severity: 'error',
      },
      validation.error.issues.map((e: any) => ({
        field: e.path.join('.'),
        message: e.message,
        code: 'VALIDATION_ERROR',
      })),
      { correlationId },
    );
  }

  try {
    const result = await userService.updateUserMetadata(userId, validation.data.metadata);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}/metadata`, 200, duration, correlationId);
    return ok(result, 'User metadata updated', { requestId: correlationId });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}/metadata`, 404, duration, correlationId);
      return notFound(
        {
          title: 'User not found',
          description: err.message,
          severity: 'error',
        },
        [{ code: 'USER_NOT_FOUND', message: err.message }],
        { correlationId },
      );
    }
    logger.error({ event: 'updateUserMetadata_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}/metadata`, 500, duration, correlationId);
    return internalServerError(
      {
        title: 'Failed to update user metadata',
        description: (err as Error)?.message || 'Unknown error',
        severity: 'error',
      },
      [{ code: 'UPDATE_USER_METADATA_FAILED', message: (err as Error)?.message || 'Unknown error' }],
      { correlationId },
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
    return badRequest(
      {
        title: 'Invalid request',
        description: 'userId is required',
        severity: 'error',
      },
      [{ code: 'BAD_REQUEST', message: 'userId is required' }],
      { correlationId },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'listUserFiles_received', eventData: event });

  try {
    const result = await userService.listUserFiles(userId);
    const duration = Date.now() - startTime;
    logger.info({ event: 'listUserFiles_success', count: result.length });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/files`, 200, duration, correlationId);
    return ok(result, 'User files retrieved successfully', { requestId: correlationId });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/files`, 404, duration, correlationId);
      return notFound(
        {
          title: 'User not found',
          description: err.message,
          severity: 'error',
        },
        [{ code: 'USER_NOT_FOUND', message: err.message }],
        { correlationId },
      );
    }
    logger.error({ event: 'listUserFiles_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/files`, 500, duration, correlationId);
    return internalServerError(
      {
        title: 'Failed to list user files',
        description: (err as Error)?.message || 'Unknown error',
        severity: 'error',
      },
      [{ code: 'LIST_USER_FILES_FAILED', message: (err as Error)?.message || 'Unknown error' }],
      { correlationId },
    );
  }
}

