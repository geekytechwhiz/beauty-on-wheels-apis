import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError,
  logHttpRequest,
  createChildLogger,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();

const PATH = '/organization/count';

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  const logger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });
  logger.info({ event: 'getOrganizationCount_received' });

  try {
    const result = await organizationService.getOrganizationCounts(correlationId);
    
    logger.info({ 
      event: 'getOrganizationCount_success', 
      total: result.total,
      orgType: result.orgType
    });
    
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 200, duration, correlationId);
    
    return ApiResponse.ok(
      { 
        total: result.total, 
        orgType: result.orgType 
      },
      {
        title: 'Organization count success',
        description: 'The organization count completed successfully.',
      },
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'getOrganizationCount_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_SERVER_ERROR',
      { requestId: correlationId, event },
      { code: 'INTERNAL_SERVER_ERROR' },
    );
  }
};
