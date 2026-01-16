import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ulid } from 'ulid';
import { OrganizationNotFoundError } from '../utils/errors';
import { ok, problem } from '../utils/response';
import { updateOrganizationSchema } from '../validation/organization.validation';
import { normalizeOrganizationPayload } from '../utils/organizationPayload';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const rawOrganizationId = event.pathParameters?.organizationId;
  const organizationId = rawOrganizationId
    ? decodeURIComponent(rawOrganizationId).replace(/^\{|\}$/g, '')
    : undefined;

  if (!organizationId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 400, duration, correlationId);
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'organizationId is required',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const logger = createChildLogger(baseLogger, { correlationId, organizationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'updateOrganization_received' });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'updateOrganization_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 400, duration, correlationId);
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'Invalid JSON body',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const normalized = normalizeOrganizationPayload(body);
  const rawBody = body as { adminDetails?: unknown } | null;
  if (rawBody?.adminDetails !== undefined && normalized.data.adminDetails === undefined) {
    normalized.data.adminDetails = rawBody.adminDetails;
  }
  if (normalized.data.organizationInfo && typeof normalized.data.organizationInfo === 'object') {
    normalized.data.organizationInfo = {
      ...(normalized.data.organizationInfo as Record<string, unknown>),
      organizationID: organizationId,
    };
  }
  if (normalized.errors.length > 0) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 400, duration, correlationId);
    return problem({
      title: 'Validation error',
      status: 400,
      detail: 'Invalid request body',
      correlationId,
      code: 'VALIDATION_ERROR',
      errors: normalized.errors,
    });
  }

  const validationResult = updateOrganizationSchema.safeParse(normalized.data);
  if (!validationResult.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 400, duration, correlationId);
    return problem({
      title: 'Validation error',
      status: 400,
      detail: 'Invalid request body',
      correlationId,
      code: 'VALIDATION_ERROR',
      errors: validationResult.error.issues.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      })),
    });
  }

  try {
    if (rawBody?.adminDetails && typeof normalized.data.adminDetails === 'object') {
      const adminDetails = normalized.data.adminDetails as Record<string, unknown>;
      const userServiceUrl = process.env.USER_SERVICE_URL;
      const authHeader =
        event.headers?.Authorization ||
        event.headers?.authorization ||
        event.headers?.AUTHORIZATION;

      if (!userServiceUrl) {
        const duration = Date.now() - startTime;
        logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 500, duration, correlationId);
        return problem({
          title: 'Missing configuration',
          status: 500,
          detail: 'USER_SERVICE_URL is not configured',
          correlationId,
          code: 'USER_SERVICE_URL_MISSING',
        });
      }

      if (!authHeader) {
        const duration = Date.now() - startTime;
        logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 401, duration, correlationId);
        return problem({
          title: 'Unauthorized',
          status: 401,
          detail: 'Authorization header is required to create admin user',
          correlationId,
          code: 'UNAUTHORIZED',
        });
      }

      const existingOrganization = await organizationService.getOrganization(organizationId);
      logger.info({ event: 'existingOrganization', existingOrganization });
      const existingAdminDetails = existingOrganization?.adminDetails as Record<string, unknown> | undefined;
      const existingAdminId =
        typeof existingAdminDetails?.adminId === 'string' ? existingAdminDetails.adminId.trim() : '';
      const hasExistingAdmin = existingAdminId.length > 0;
      const orgStatus = existingOrganization?.status;
      logger.info({ event: 'hasExistingAdmin', hasExistingAdmin });
      logger.info({ event: 'orgStatus', orgStatus });
      let adminId = String(adminDetails.adminId || '').trim();
      logger.info({ event: 'adminId', adminId });
      if (!adminId) {
        if (hasExistingAdmin) {
          const duration = Date.now() - startTime;
          logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 400, duration, correlationId);
          return problem({
            title: 'Invalid request',
            status: 400,
            detail: 'Admin already exists for this organization',
            correlationId,
            code: 'ADMIN_ALREADY_CREATED',
          });
        }
        adminId = ulid();
        adminDetails.adminId = adminId;
      } else {
        adminDetails.adminId = adminId;
      }
      const adminName =
        String(
          adminDetails.adminName ||
            adminDetails.fullName ||
            adminDetails.name ||
            '',
        ).trim();
      const email = typeof adminDetails.emailAddress === 'string' ? adminDetails.emailAddress : undefined;
      const phone = typeof adminDetails.phoneNumber === 'string' ? adminDetails.phoneNumber : undefined;
      const phoneCode = typeof adminDetails.phoneCode === 'string' ? adminDetails.phoneCode : undefined;
      const adminAddress = adminDetails.adminAddress as Record<string, unknown> | undefined;
      const profilePic = adminDetails.profilePic as string | undefined;
      const userType = String(adminDetails.userType || 'STAFF');
      const userRoleRaw = adminDetails.userRole;
      const userRole = Array.isArray(userRoleRaw)
        ? userRoleRaw.map((role) => String(role))
        : userRoleRaw
          ? [String(userRoleRaw)]
          : ['ADMIN'];

      const userTypeUpper = userType.toUpperCase();
      if (userTypeUpper === 'STAFF' && (!email || email.trim() === '')) {
        const duration = Date.now() - startTime;
        logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 400, duration, correlationId);
        return problem({
          title: 'Invalid request',
          status: 400,
          detail: 'Email is required to create STAFF admin user',
          correlationId,
          code: 'ADMIN_EMAIL_REQUIRED',
        });
      }

      if (
        (userTypeUpper === 'USER' || userTypeUpper === 'FNF') &&
        (!email || email.trim() === '') &&
        (!phone || String(phone).trim() === '')
      ) {
        const duration = Date.now() - startTime;
        logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 400, duration, correlationId);
        return problem({
          title: 'Invalid request',
          status: 400,
          detail: 'Email or phone is required to create admin user',
          correlationId,
          code: 'ADMIN_CONTACT_REQUIRED',
        });
      }

      const userInfoPayload = {
        name: adminName,
        namePrefix: adminDetails.namePrefix,
        profilePic,
        contact: {
          email,
          phone,
          phoneCode,
          address: adminAddress,
        },
        position: adminDetails.position,
        department: adminDetails.department,
      };

      const userServiceBase = userServiceUrl.replace(/\/$/, '');
      const createUserPayload = {
        organizationID: organizationId,
        userID: adminId,
        userInfo: userInfoPayload,
        userRole,
        userType,
      };
      const isAdminIdProvided = !!String((rawBody as any)?.adminDetails?.adminId || '').trim();
      const shouldUpdateUser = isAdminIdProvided && orgStatus === 'ACTIVE';

      if (!isAdminIdProvided) {

        const createUserResponse = await fetch(userServiceBase, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify(createUserPayload),
        });

        if (!createUserResponse.ok) {
          const responseText = await createUserResponse.text();
          const duration = Date.now() - startTime;
          logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, createUserResponse.status, duration, correlationId);
          return problem({
            title: 'Failed to create admin user',
            status: createUserResponse.status,
            detail: responseText || 'User service request failed',
            correlationId,
            code: 'CREATE_ADMIN_USER_FAILED',
          });
        }
      } else if (shouldUpdateUser) {
        const updateUserPayload = {
          userInfo: userInfoPayload,
          userRole,
          userType,
        };

        let createdAdminUser = false;
        const updateUserResponse = await fetch(
          `${userServiceBase}/organization/${organizationId}/${adminId}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            body: JSON.stringify(updateUserPayload),
          },
        );

        if (!updateUserResponse.ok) {
          if (updateUserResponse.status === 404) {
            if (!hasExistingAdmin) {
              const createUserResponse = await fetch(userServiceBase, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: authHeader,
                },
                body: JSON.stringify(createUserPayload),
              });

              if (!createUserResponse.ok) {
                const responseText = await createUserResponse.text();
                const duration = Date.now() - startTime;
                logHttpRequest(
                  logger,
                  event.httpMethod || 'PUT',
                  event.path || `/organization/${organizationId}`,
                  createUserResponse.status,
                  duration,
                  correlationId,
                );
                return problem({
                  title: 'Failed to create admin user',
                  status: createUserResponse.status,
                  detail: responseText || 'User service request failed',
                  correlationId,
                  code: 'CREATE_ADMIN_USER_FAILED',
                });
              }

              createdAdminUser = true;
            }
          }

          if (!createdAdminUser) {
            const responseText = await updateUserResponse.text();
            const duration = Date.now() - startTime;
            logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, updateUserResponse.status, duration, correlationId);
            return problem({
              title: 'Failed to update admin user',
              status: updateUserResponse.status,
              detail: responseText || 'User service request failed',
              correlationId,
              code: 'UPDATE_ADMIN_USER_FAILED',
            });
          }
        }
      } else {
        logger.info({
          event: 'admin_update_skipped',
          reason: 'organization_status_not_active',
          organizationStatus: orgStatus,
        });
      }
    }

    const organization = await organizationService.updateOrganization(organizationId, validationResult.data, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 200, duration, correlationId);
    return ok(organization, { requestId: correlationId, message: 'Organization updated' });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof OrganizationNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 404, duration, correlationId);
      return problem({
        title: 'Organization not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'ORGANIZATION_NOT_FOUND',
      });
    }
    logger.error({ event: 'updateOrganization_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 500, duration, correlationId);
    return problem({
      title: 'Failed to update organization',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'UPDATE_ORGANIZATION_FAILED',
    });
  }
};
