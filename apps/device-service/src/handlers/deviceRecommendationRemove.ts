import { withStandardApiGatewayPipeline } from '@api-hub/middleware';
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { ApiResponse } from '@api-hub/utils';
import { RecommendationService } from '../services/recommendationService';
import { deviceRecommendationRemoveSchema } from '../validation/device.validation';
import { createHandlerContext } from '../utils/handlerContext';
import { parseRequestBody } from '../utils/requestParser';
import { validationErrorResponse } from '../utils/validationHelper';
import { logAndRespond } from '../utils/responseHelper';
import { handleHandlerError } from '../utils/errorHandler';
import { RecommendationNotFoundError, RecommendationCannotRemovePairedError } from '../utils/errors';
import { PATHS } from '../constants/paths';
import { HTTP_METHODS } from '../constants/httpMethods';
import { ERROR_CODES } from '../constants/errorCodes';

const recommendationService = new RecommendationService();

const deviceRecommendationRemoveImpl: APIGatewayProxyHandler = async (event, context?: Context) => {
  const ctx = createHandlerContext(event, context);
  const { startTime, correlationId, logger } = ctx;
  const evt = ctx.event;
  logger.info({ event: 'deviceRecommendationRemove_received' });

  const parseResult = parseRequestBody(evt.body, logger, { parseErrorEvent: 'deviceRecommendationRemove_parse_error' });
  if (!parseResult.success) {
    return logAndRespond(
      { logger, method: evt.httpMethod || HTTP_METHODS.POST, path: evt.path || PATHS.DEVICES_RECOMMENDATIONS_REMOVE, statusCode: 400, startTime, correlationId },
      await ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event: evt }, { code: ERROR_CODES.BAD_REQUEST }),
    );
  }

  const validation = deviceRecommendationRemoveSchema.safeParse(parseResult.body);
  if (!validation.success) {
    return validationErrorResponse(validation.error, {
      correlationId,
      event: evt,
      logger,
      startTime,
      path: evt.path || PATHS.DEVICES_RECOMMENDATIONS_REMOVE,
      method: evt.httpMethod || HTTP_METHODS.POST,
      logEventName: 'deviceRecommendationRemove_validation_error',
    });
  }

  try {
    await recommendationService.removeRecommendations(
      validation.data.patientUserId,
      validation.data.doctorName,
      validation.data.devices,
      correlationId,
    );
    logger.info({
      event: 'deviceRecommendationRemove_success',
      patientUserId: validation.data.patientUserId,
      ...(validation.data.doctorName != null && { doctorName: validation.data.doctorName }),
      deviceCount: validation.data.devices.length,
    });
    return logAndRespond(
      { logger, method: evt.httpMethod || HTTP_METHODS.POST, path: evt.path || PATHS.DEVICES_RECOMMENDATIONS_REMOVE, statusCode: 200, startTime, correlationId },
      await ApiResponse.ok(
        { message: 'Devices un-recommended successfully' },
        {
          title: 'Devices unrecommend success',
          description: 'The device recommendations were removed successfully.',
        },
        { requestId: correlationId, event: evt },
      ),
    );
  } catch (err) {
    return handleHandlerError(err, {
      correlationId,
      event: evt,
      path: evt.path || PATHS.DEVICES_RECOMMENDATIONS_REMOVE,
      method: evt.httpMethod || HTTP_METHODS.POST,
      startTime,
      logger,
      logEventName: 'deviceRecommendationRemove_error',
      defaultMessageKey: 'DEVICE.RECOMMENDATION_REMOVE_FAILED',
      defaultCode: ERROR_CODES.RECOMMENDATION_REMOVE_FAILED,
      domainMap: [
        [RecommendationNotFoundError, { statusCode: 404, messageKey: 'DEVICE.RECOMMENDATION_NOT_FOUND', code: ERROR_CODES.RECOMMENDATION_NOT_FOUND }],
        [RecommendationCannotRemovePairedError, { statusCode: 400, messageKey: 'DEVICE.CANNOT_REMOVE_PAIRED_DEVICE', code: ERROR_CODES.CANNOT_REMOVE_PAIRED_DEVICE }],
      ],
    });
  }
};

export const handler = withStandardApiGatewayPipeline('device.recommendationRemove', deviceRecommendationRemoveImpl, { serviceName: 'device-service' });
