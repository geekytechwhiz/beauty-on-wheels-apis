import { withStandardApiGatewayPipeline } from '@api-hub/middleware';
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { RecommendationService } from '../services/recommendationService';
import { deviceRecommendationAddSchema } from '../validation/device.validation';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const recommendationService = new RecommendationService();

const deviceRecommendationAddImpl: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceRecommendationAdd_received' });

  // Parse body
  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'deviceRecommendationAdd_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/add', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  // Authorization disabled - extract values from body
  const bodyData = body as any;
  const doctorId = bodyData.doctorId || bodyData.userID || 'SYSTEM';
  const organizationId = bodyData.organizationID || bodyData.organizationId;

  // Validation
  const validation = deviceRecommendationAddSchema.safeParse({ 
    ...bodyData, 
    userID: doctorId, 
    organizationID: organizationId 
  });
  
  if (!validation.success) {
    logger.warn({ event: 'deviceRecommendationAdd_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/add', 400, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      {  correlationId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    );
  }

  try {
    // Use doctorId from validation or fallback to 'SYSTEM'
    const finalDoctorId = validation.data.userID || 'SYSTEM';
    
    // organizationID is now optional - will use from body if provided
    const finalOrganizationId = validation.data.organizationID || organizationId || 'DEFAULT_ORG';

    await recommendationService.recommendDevices(
      validation.data.patientUserId,
      finalDoctorId,
      validation.data.doctorName,
      finalOrganizationId,
      validation.data.devices,
      correlationId,
    );
    
    logger.info({
      event: 'deviceRecommendationAdd_success',
      patientUserId: validation.data.patientUserId,
      doctorName: validation.data.doctorName,
      deviceCount: validation.data.devices.length,
    });

    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/add', 200, duration, correlationId);
    
    return ApiResponse.ok(
      { message: 'Devices recommended to a patient successfully' },
      {
        title: 'Device recommend success',
        description: 'The device recommend completed successfully.',
      },
      {  correlationId: correlationId, event }
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceRecommendationAdd_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/add', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.RECOMMENDATION_ADD_FAILED', {  correlationId: correlationId, event }, { code: 'RECOMMENDATION_ADD_FAILED' });
  }
};

export const handler = withStandardApiGatewayPipeline('device.recommendationAdd', deviceRecommendationAddImpl, { serviceName: 'device-service' });
