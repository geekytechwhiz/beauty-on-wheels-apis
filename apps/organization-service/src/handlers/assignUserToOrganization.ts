import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { OrganizationNotFoundError } from '../utils/errors';
import { ok, problem } from '../utils/response';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const organizationId = event.pathParameters?.organizationId;
  const userId = event.pathParameters?.userId;

  if (!organizationId || !userId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || `/organization/${organizationId}/user/${userId}`, 400, duration, correlationId);
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'organizationId and userId are required',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const logger = createChildLogger(baseLogger, { correlationId, organizationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'assignUserToOrganization_received' });

  let body: { role?: string } = {};
  if (event.body) {
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (err) {
      logger.warn({ event: 'assignUserToOrganization_parse_warning', err: serializeError(err) });
    }
  }

  try {
    await organizationService.assignUserToOrganization(organizationId, userId, body.role, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || `/organization/${organizationId}/user/${userId}`, 200, duration, correlationId);
    return ok(null, { requestId: correlationId, message: 'User assigned to organization' });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof OrganizationNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || `/organization/${organizationId}/user/${userId}`, 404, duration, correlationId);
      return problem({
        title: 'Organization not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'ORGANIZATION_NOT_FOUND',
      });
    }
    logger.error({ event: 'assignUserToOrganization_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || `/organization/${organizationId}/user/${userId}`, 500, duration, correlationId);
    return problem({
      title: 'Failed to assign user to organization',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'ASSIGN_USER_FAILED',
    });
  }
};
