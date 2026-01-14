import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { UserService } from '../../services/user.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { UserNotFoundError } from '../../utils/errors';
import { fhirBundle, getBaseUrl, FhirErrorHandler, Resource } from '@api-hub/fhir';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const patientId = event.pathParameters?.id;

  if (!patientId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/fhir/Patient/${patientId}/organizations`, 400, duration, correlationId);
    return FhirErrorHandler.handle(
      new Error('Patient ID is required'),
      event,
      correlationId
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, patientId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'listUserOrganizations_fhir_received' });

  try {
    const userOrgs = await userService.listUserOrganizations(patientId);
    const baseUrl = getBaseUrl(event);
    
    // Convert to FHIR Bundle with Organization references
    // Note: In a full implementation, you might want to fetch full Organization resources
    // For now, we return a Bundle with references
    const resources: Resource[] = userOrgs.map((userOrg) => ({
      resourceType: 'Organization',
      id: userOrg.organizationId,
      meta: {
        lastUpdated: userOrg.assignedAt,
        ...(baseUrl && { source: baseUrl }),
      },
    }));
    
    const duration = Date.now() - startTime;
    logger.info({ event: 'listUserOrganizations_fhir_success', count: resources.length });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/fhir/Patient/${patientId}/organizations`, 200, duration, correlationId);
    return fhirBundle(resources, { correlationId, type: 'searchset' });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/fhir/Patient/${patientId}/organizations`, 404, duration, correlationId);
      return FhirErrorHandler.handle(err, event, correlationId);
    }
    logger.error({ event: 'listUserOrganizations_fhir_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/fhir/Patient/${patientId}/organizations`, 500, duration, correlationId);
    return FhirErrorHandler.handle(err, event, correlationId);
  }
};
