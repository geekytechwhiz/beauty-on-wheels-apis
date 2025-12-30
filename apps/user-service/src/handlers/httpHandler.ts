import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { UserService } from '../services/user.service';
import { createLogger, extractCorrelationId, serializeError, logHttpRequest, extractAwsRequestId, createChildLogger } from '@api-hub/logger';
import { ok, created, problem } from '../utils/response';
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
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'Invalid JSON body',
      correlationId,
      code: 'BAD_REQUEST',
    });
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
    return problem({
      title: 'Validation failed',
      status: 400,
      detail: 'Invalid request data',
      correlationId,
      code: 'VALIDATION_ERROR',
      errors: validation.error.issues.map((e: any) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  try {
    const { userInfo, userRole, userType } = validation.data;
    const userData = {
      fullName: userInfo.name,
      namePrefix: userInfo.namePrefix,
      profilePic: userInfo.profilePic,
      licenseNumber: userInfo.licenseNumber,
      emailAddress: userInfo.contact.email,
      phoneNumber: userInfo.contact.phone,
      phoneCode: userInfo.contact.phoneCode,
      workingHours: userInfo.workingHours,
      dateOfBirth: userInfo.dateOfBirth,
      department: userInfo.department,
      gender: userInfo.gender,
      specialty: userInfo.specialty,
      slotDurationInMinutes: userInfo.slotDurationInMinutes,
      experienceInYears: userInfo.experienceInYears,
      bio: userInfo.bio,
      userRole: userRole,
      userType: userType
    };
    const result = await userService.createUser(userData, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users', 201, duration, correlationId);
    return created(result, { requestId: correlationId, message: 'User created' });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserAlreadyExistsError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users', 409, duration, correlationId);
      return problem({
        title: 'User already exists',
        status: 409,
        detail: err.message,
        correlationId,
        code: 'USER_ALREADY_EXISTS',
      });
    }
    logger.error({ event: 'createUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users', 500, duration, correlationId);
    return problem({
      title: 'Failed to create user',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'CREATE_USER_FAILED',
    });
  }
}

export async function getUser(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const userId = event.pathParameters?.userId;

  if (!userId) {
    const duration = Date.now() - startTime;
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 400, duration, correlationId);
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'userId is required',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'getUser_received', eventData: event });

  try {
    const result = await userService.getUser(userId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 200, duration, correlationId);
    return ok(result, { requestId: correlationId });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 404, duration, correlationId);
      return problem({
        title: 'User not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'USER_NOT_FOUND',
      });
    }
    logger.error({ event: 'getUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 500, duration, correlationId);
    return problem({
      title: 'Failed to get user',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'GET_USER_FAILED',
    });
  }
}

export async function updateUser(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const userId = event.pathParameters?.userId;

  if (!userId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}`, 400, duration, correlationId);
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'userId is required',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'updateUser_received', eventData: event });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'updateUser_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}`, 400, duration, correlationId);
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'Invalid JSON body',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const validation = updateUserSchema.safeParse({ ...(body as Record<string, unknown>), userId });
  if (!validation.success) {
    logger.warn({ event: 'updateUser_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}`, 400, duration, correlationId);
    return problem({
      title: 'Validation failed',
      status: 400,
      detail: 'Invalid request data',
      correlationId,
      code: 'VALIDATION_ERROR',
      errors: validation.error.issues.map((e: any) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  try {
    const result = await userService.updateUser(userId, validation.data, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}`, 200, duration, correlationId);
    return ok(result, { requestId: correlationId, message: 'User updated' });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}`, 404, duration, correlationId);
      return problem({
        title: 'User not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'USER_NOT_FOUND',
      });
    }
    logger.error({ event: 'updateUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}`, 500, duration, correlationId);
    return problem({
      title: 'Failed to update user',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'UPDATE_USER_FAILED',
    });
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
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'userId is required',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deleteUser_received', eventData: event });

  try {
    await userService.deleteUser(userId, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/users/${userId}`, 200, duration, correlationId);
    return ok(null, { requestId: correlationId, message: 'User deleted' });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/users/${userId}`, 404, duration, correlationId);
      return problem({
        title: 'User not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'USER_NOT_FOUND',
      });
    }
    logger.error({ event: 'deleteUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/users/${userId}`, 500, duration, correlationId);
    return problem({
      title: 'Failed to delete user',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'DELETE_USER_FAILED',
    });
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
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'Invalid JSON body',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const validation = assignUserToOrganizationSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'assignUserToOrg_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 400, duration, correlationId);
    return problem({
      title: 'Validation failed',
      status: 400,
      detail: 'Invalid request data',
      correlationId,
      code: 'VALIDATION_ERROR',
      errors: validation.error.issues.map((e: any) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  try {
    await userService.assignUserToOrganization(validation.data.userId, validation.data.organizationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 200, duration, correlationId);
    return ok(null, { requestId: correlationId, message: 'User assigned to organization' });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 404, duration, correlationId);
      return problem({
        title: 'User not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'USER_NOT_FOUND',
      });
    }
    logger.error({ event: 'assignUserToOrg_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 500, duration, correlationId);
    return problem({
      title: 'Failed to assign user to organization',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'ASSIGN_USER_ORG_FAILED',
    });
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
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'userId is required',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'listUserOrgs_received', eventData: event });

  try {
    const result = await userService.listUserOrganizations(userId);
    const duration = Date.now() - startTime;
    logger.info({ event: 'listUserOrgs_success', count: result.length });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/organizations`, 200, duration, correlationId);
    return ok(result, { requestId: correlationId });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/organizations`, 404, duration, correlationId);
      return problem({
        title: 'User not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'USER_NOT_FOUND',
      });
    }
    logger.error({ event: 'listUserOrgs_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/organizations`, 500, duration, correlationId);
    return problem({
      title: 'Failed to list user organizations',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'LIST_USER_ORGS_FAILED',
    });
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
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'userId is required',
      correlationId,
      code: 'BAD_REQUEST',
    });
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
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'Invalid JSON body',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const validation = updateUserMetadataSchema.safeParse({ ...(body as Record<string, unknown>), userId });
  if (!validation.success) {
    logger.warn({ event: 'updateUserMetadata_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}/metadata`, 400, duration, correlationId);
    return problem({
      title: 'Validation failed',
      status: 400,
      detail: 'Invalid request data',
      correlationId,
      code: 'VALIDATION_ERROR',
      errors: validation.error.issues.map((e: any) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  try {
    const result = await userService.updateUserMetadata(userId, validation.data.metadata);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}/metadata`, 200, duration, correlationId);
    return ok(result, { requestId: correlationId, message: 'User metadata updated' });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}/metadata`, 404, duration, correlationId);
      return problem({
        title: 'User not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'USER_NOT_FOUND',
      });
    }
    logger.error({ event: 'updateUserMetadata_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/users/${userId}/metadata`, 500, duration, correlationId);
    return problem({
      title: 'Failed to update user metadata',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'UPDATE_USER_METADATA_FAILED',
    });
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
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'userId is required',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'listUserFiles_received', eventData: event });

  try {
    const result = await userService.listUserFiles(userId);
    const duration = Date.now() - startTime;
    logger.info({ event: 'listUserFiles_success', count: result.length });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/files`, 200, duration, correlationId);
    return ok(result, { requestId: correlationId });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/files`, 404, duration, correlationId);
      return problem({
        title: 'User not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'USER_NOT_FOUND',
      });
    }
    logger.error({ event: 'listUserFiles_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}/files`, 500, duration, correlationId);
    return problem({
      title: 'Failed to list user files',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'LIST_USER_FILES_FAILED',
    });
  }
}

