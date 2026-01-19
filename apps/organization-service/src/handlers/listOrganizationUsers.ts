import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { OrganizationNotFoundError } from '../utils/errors';
import { ApiResponse } from '@api-hub/utils';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const organizationId = event.pathParameters?.organizationId;

  if (!organizationId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}/users`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      { title: 'Invalid request', description: 'organizationId is required' },
      { requestId: correlationId },
      { code: 'BAD_REQUEST' },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, organizationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'listOrganizationUsers_received' });

  try {
    const users = await organizationService.listOrganizationUsers(organizationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}/users`, 200, duration, correlationId);
    return ApiResponse.ok(
      users,
      { title: 'Success', description: 'Organization users retrieved successfully' },
      { requestId: correlationId },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof OrganizationNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}/users`, 404, duration, correlationId);
      return ApiResponse.notFound(
        { title: 'Organization not found', description: err.message },
        { requestId: correlationId },
        { code: 'ORGANIZATION_NOT_FOUND' },
      );
    }
    logger.error({ event: 'listOrganizationUsers_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}/users`, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      { title: 'Failed to list organization users', description: (err as Error)?.message || 'Unknown error' },
      { requestId: correlationId },
      { code: 'LIST_USERS_FAILED' },
    );
  }
};
