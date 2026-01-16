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
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/fhir/Patient/${patientId}/files`, 400, duration, correlationId);
    return FhirErrorHandler.handle(
      new Error('Patient ID is required'),
      event,
      correlationId
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, patientId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'listUserFiles_fhir_received' });

  try {
    const userFiles = await userService.listUserFiles(patientId);
    const baseUrl = getBaseUrl(event);
    
    // Convert to FHIR Bundle with DocumentReference resources
    // Note: In FHIR, files are typically represented as DocumentReference resources
    const resources: Resource[] = userFiles.map((userFile) => ({
      resourceType: 'DocumentReference',
      id: userFile.fileId,
      status: 'current',
      type: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '51848-0',
            display: 'Patient summary',
          },
        ],
      },
      subject: {
        reference: `Patient/${patientId}`,
        type: 'Patient',
      },
      content: [
        {
          attachment: {
            contentType: 'application/octet-stream', // Could be determined from file extension
            url: `s3://${process.env.USER_FILES_BUCKET}/${userFile.s3Key}`,
            title: userFile.fileName,
          },
        },
      ],
      meta: {
        lastUpdated: userFile.uploadedAt,
        ...(baseUrl && { source: baseUrl }),
      },
    }));
    
    const duration = Date.now() - startTime;
    logger.info({ event: 'listUserFiles_fhir_success', count: resources.length });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/fhir/Patient/${patientId}/files`, 200, duration, correlationId);
    return fhirBundle(resources, { correlationId, type: 'searchset', baseUrl });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/fhir/Patient/${patientId}/files`, 404, duration, correlationId);
      return FhirErrorHandler.handle(err, event, correlationId);
    }
    logger.error({ event: 'listUserFiles_fhir_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/fhir/Patient/${patientId}/files`, 500, duration, correlationId);
    return FhirErrorHandler.handle(err, event, correlationId);
  }
};
