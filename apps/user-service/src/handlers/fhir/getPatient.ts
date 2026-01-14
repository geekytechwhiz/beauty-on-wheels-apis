import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { UserService } from '../../services/user.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { UserNotFoundError } from '../../utils/errors';
import { toPatient, fhirOk, getBaseUrl, FhirErrorHandler, FhirValidator } from '@api-hub/fhir';

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
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/fhir/Patient/${patientId}`, 400, duration, correlationId);
    return FhirErrorHandler.handle(
      new Error('Patient ID is required'),
      event,
      correlationId
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, patientId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'getPatient_received' });

  try {
    const user = await userService.getUser(patientId);
    const baseUrl = getBaseUrl(event);
    const patient = toPatient(user, baseUrl);
    
    // Validate FHIR resource
    const validation = FhirValidator.validate(patient);
    if (!validation.valid) {
      logger.warn({ 
        event: 'getPatient_validation_warning', 
        validationErrors: validation.errors,
        validationWarnings: validation.warnings
      });
    }
    
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/fhir/Patient/${patientId}`, 200, duration, correlationId);
    return fhirOk(patient, { correlationId });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/fhir/Patient/${patientId}`, 404, duration, correlationId);
      return FhirErrorHandler.handle(err, event, correlationId);
    }
    logger.error({ event: 'getPatient_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/fhir/Patient/${patientId}`, 500, duration, correlationId);
    return FhirErrorHandler.handle(err, event, correlationId);
  }
};
