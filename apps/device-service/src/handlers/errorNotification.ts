import { withApiHandler } from '@api-hub/middleware';
import { Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { errorNotificationSchema } from '../validation/device.validation';
import { publishDeviceErrorNotification } from '../services/notification.service';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const PATH = '/devices/error-notification';

const errorNotificationImpl: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'errorNotification_received' });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'errorNotification_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  const validation = errorNotificationSchema.safeParse(body);
  if (!validation.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      {  correlationId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
      }
    );
  }

  const data = validation.data;
  try {
    await publishDeviceErrorNotification({
      userId: data.userId,
      email: data.email,
      phone: data.phone,
      deviceToken: data.deviceToken,
      name: data.name,
      channels: data.channels,
      template: data.template,
      templateData: data.templateData,
      deviceId: data.deviceId,
      errorCode: data.errorCode,
      correlationId,
    });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 200, duration, correlationId);
    return ApiResponse.ok({ message: 'Notification requested' }, 'DEVICE.ERROR_NOTIFICATION_REQUESTED', {
       correlationId: correlationId,
      event: event,
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'errorNotification_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_SERVER_ERROR',
      {  correlationId: correlationId, event },
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
};

export const handler = withApiHandler({   useLegacyResponseFormat: true, operation: 'device.errorNotification' }, errorNotificationImpl);
