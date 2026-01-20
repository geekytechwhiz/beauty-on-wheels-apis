import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { createOrganizationSchema } from '../validation/organization.validation';
import { OrganizationAlreadyExistsError } from '../utils/errors';
import { normalizeOrganizationPayload, generateOrganizationId } from '../utils/organizationPayload';
import { RoleRepository } from '../repositories/role.repository';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();
const roleRepository = new RoleRepository();

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'createOrganization_received' });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'createOrganization_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization', 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST' },
    );
  }

  const normalized = normalizeOrganizationPayload(body);
  if (normalized.errors.length > 0) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization', 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: normalized.errors.map((e) => ({
          field: (e as any).field,
          message: (e as any).message ?? 'Invalid request body',
        })),
      },
    );
  }

  const authorizer = (event.requestContext as { authorizer?: Record<string, any> } | undefined)?.authorizer;
  const creatorId =
    authorizer?.userId ||
    authorizer?.userID ||
    authorizer?.claims?.sub ||
    authorizer?.claims?.['custom:userID'];

  const organizationId = normalized.data.organizationId || generateOrganizationId();
  const payload = {
    ...normalized.data,
    organizationId,
    createdBy: creatorId,
  };

  const validationResult = createOrganizationSchema.safeParse(payload);
  if (!validationResult.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization', 400, duration, correlationId);
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

  try {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    const rolesCreated = await roleRepository.createDefaultRoles(organizationId, authHeader);
    if (!rolesCreated) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization', 500, duration, correlationId);
      return ApiResponse.internalServerError(
        'ORGANIZATION.CREATE_ORGANIZATION_FAILED',
        { requestId: correlationId, event },
        { code: 'CREATE_DEFAULT_ROLES_FAILED' },
      );
    }
    const organization = await organizationService.createOrganization(validationResult.data, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization', 201, duration, correlationId);
    return ApiResponse.created(
      {
        newOrganizationID: organization.organizationId,
        hospitalImage: organization.hospitalImage,
      },
      'ORGANIZATION.ORGANIZATION_CREATED_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof OrganizationAlreadyExistsError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization', 409, duration, correlationId);
      return ApiResponse.conflict(
        'ORGANIZATION.ORGANIZATION_ALREADY_EXISTS',
        { requestId: correlationId, event },
        { code: 'ORGANIZATION_ALREADY_EXISTS' },
      );
    }
    logger.error({ event: 'createOrganization_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization', 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'ORGANIZATION.CREATE_ORGANIZATION_FAILED',
      { requestId: correlationId, event },
      { code: 'CREATE_ORGANIZATION_FAILED' },
    );
  }
};
