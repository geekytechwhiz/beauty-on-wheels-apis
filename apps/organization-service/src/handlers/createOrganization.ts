import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { created, problem } from '../utils/response';
import { createOrganizationSchema } from '../validation/organization.validation';
import { OrganizationAlreadyExistsError } from '../utils/errors';
import { normalizeOrganizationPayload } from '../utils/organizationPayload';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();

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
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'Invalid JSON body',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const normalized = normalizeOrganizationPayload(body);
  if (normalized.errors.length > 0) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization', 400, duration, correlationId);
    return problem({
      title: 'Validation error',
      status: 400,
      detail: 'Invalid request body',
      correlationId,
      code: 'VALIDATION_ERROR',
      errors: normalized.errors,
    });
  }

  const validationResult = createOrganizationSchema.safeParse(normalized.data);
  if (!validationResult.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization', 400, duration, correlationId);
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
    const organization = await organizationService.createOrganization(validationResult.data, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization', 201, duration, correlationId);
    return created(organization, { requestId: correlationId, message: 'Organization created' });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof OrganizationAlreadyExistsError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization', 409, duration, correlationId);
      return problem({
        title: 'Organization already exists',
        status: 409,
        detail: err.message,
        correlationId,
        code: 'ORGANIZATION_ALREADY_EXISTS',
      });
    }
    logger.error({ event: 'createOrganization_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization', 500, duration, correlationId);
    return problem({
      title: 'Failed to create organization',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'CREATE_ORGANIZATION_FAILED',
    });
  }
};
