import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { UserRepository } from '../repositories/user.repository';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { OrganizationNotFoundError } from '../utils/errors';
import { ApiResponse } from '@api-hub/utils';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();
const userRepository = new UserRepository();

const buildAdminAddress = (user?: Record<string, unknown>) => {
  if (!user) return undefined;
  const address = {
    address: user.address,
    city: user.city,
    state: user.state,
    country: user.country,
    postalCode: user.postalCode,
    countryCode: user.countryCode,
  } as Record<string, unknown>;
  const hasAny = Object.values(address).some((value) => value !== undefined && value !== null && String(value).trim() !== '');
  return hasAny ? address : undefined;
};

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const organizationId = event.pathParameters?.organizationId;

  if (!organizationId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST' },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, organizationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'getOrganization_received' });

  try {
    const organization = await organizationService.getOrganization(organizationId);
    const authHeader =
      event.headers?.Authorization ||
      event.headers?.authorization ||
      event.headers?.AUTHORIZATION;
    const adminDetails = Array.isArray(organization.adminDetails) ? organization.adminDetails : [];
    if (adminDetails.length > 0) {
      const enrichedAdmins = await Promise.all(
        adminDetails.map(async (adminDetail: any) => {
          const adminId = adminDetail?.adminId;
          if (!adminId) return adminDetail;
          try {
            const user = await userRepository.getUser(organizationId, adminId, authHeader);
            if (!user) return adminDetail;
            const mergedAddress = adminDetail?.adminAddress ?? buildAdminAddress(user);
            return {
              ...adminDetail,
              adminName: adminDetail?.adminName ?? user?.fullName ?? user?.name,
              namePrefix: adminDetail?.namePrefix ?? user?.namePrefix,
              phoneCode: adminDetail?.phoneCode ?? user?.phoneCode,
              phoneNumber: adminDetail?.phoneNumber ?? user?.phoneNumber,
              profilePic: adminDetail?.profilePic ?? user?.profilePic,
              emailAddress: adminDetail?.emailAddress ?? user?.emailAddress,
              adminAddress: mergedAddress,
            };
          } catch (err) {
            logger.warn({ event: 'getOrganization_admin_user_failed', adminId, err: serializeError(err) });
            return adminDetail;
          }
        }),
      );
      organization.adminDetails = enrichedAdmins;
    }
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}`, 200, duration, correlationId);
    return ApiResponse.ok(
      organization,
      'ORGANIZATION.ORGANIZATION_RETRIEVED_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof OrganizationNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}`, 404, duration, correlationId);
      return ApiResponse.notFound(
        'ORGANIZATION.ORGANIZATION_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'ORGANIZATION_NOT_FOUND' },
      );
    }
    logger.error({ event: 'getOrganization_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}`, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'ORGANIZATION.GET_ORGANIZATION_FAILED',
      { requestId: correlationId, event },
      { code: 'GET_ORGANIZATION_FAILED' },
    );
  }
};
