import { withStandardApiGatewayPipeline } from '@api-hub/middleware';
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError,
  logHttpRequest,
  createChildLogger,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { OrgDeviceRepository } from '../repositories/orgDeviceRepository';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const orgDeviceRepository = new OrgDeviceRepository();

const getOrganizationDeviceImpl: APIGatewayProxyHandler = async (
  event,
  context?: Context,
) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });
  logger.info({ event: 'deviceList_received' });

  // Parse request body for POST requests
  let requestData: any = {};
  requestData = event.pathParameters || {};
  logger.info({ event: 'deviceList_query_params', requestData });

  // Handle both organizationID and organizationId for flexibility
  const organizationID = requestData.organizationId;
  logger.info({
    event: 'deviceList_parsed_params',
    organizationID,
    hasOrganizationId: !!requestData.organizationId,
    hasOrganizationID: !!requestData.organizationID,
  });
  try {
    if (!organizationID) {
      const duration = Date.now() - startTime;
      logHttpRequest(
        logger,
        event.httpMethod || 'GET',
        event.path || '/devices/list',
        400,
        duration,
        correlationId,
      );
      return ApiResponse.badRequest(
        'DEVICE.ORGANIZATION_ID_REQUIRED',
        { requestId: correlationId, event },
        { code: 'ORGANIZATION_ID_REQUIRED' },
      );
    } 
      const allDevices =
        await orgDeviceRepository.getOrgDevices(organizationID);
      const duration = Date.now() - startTime;
      logHttpRequest(
        logger,
        event.httpMethod || 'GET',
        event.path || '/devices/list',
        200,
        duration,
        correlationId,
      );
      return ApiResponse.ok(
        allDevices,
        'DEVICE.DEVICE_LIST_RETRIEVED_SUCCESS',
        { requestId: correlationId, event },
      ); 
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceList_error', err: serializeError(err) });
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || '/devices/list',
      500,
      duration,
      correlationId,
    );
    return ApiResponse.internalServerError(
      'DEVICE.LIST_RETRIEVAL_FAILED',
      { requestId: correlationId, event },
      { code: 'LIST_RETRIEVAL_FAILED' },
    );
  }
};

export const handler = withStandardApiGatewayPipeline('device.getOrganization', getOrganizationDeviceImpl, { serviceName: 'device-service' });
