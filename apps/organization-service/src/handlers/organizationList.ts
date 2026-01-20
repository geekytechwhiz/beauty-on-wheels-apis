import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'organizationList_received' });

  try {
    const organizations = await organizationService.listOrganizations();
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/organization/list', 200, duration, correlationId);
    return ApiResponse.ok(
      organizations,
      { title: 'Success', description: 'Organizations retrieved successfully' },
      { requestId: correlationId },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'organizationList_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/organization/list', 500, duration, correlationId);
    return ApiResponse.internalServerError(
      { title: 'Failed to list organizations', description: (err as Error)?.message || 'Unknown error' },
      { requestId: correlationId },
      { code: 'LIST_ORGANIZATIONS_FAILED' },
    );
  }
};
