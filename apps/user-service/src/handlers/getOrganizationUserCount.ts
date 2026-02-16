import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { UserService } from '../services/user.service';
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError,
  logHttpRequest,
  createChildLogger,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { getAuthorizerOrganizationId } from '../utils/helpers';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

const PATH = '/user/organization-user-count';

export async function main(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  const logger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });
  logger.info({ event: 'getOrganizationUserCount_received' });

  const organizationId = getAuthorizerOrganizationId(event);
  if (!organizationId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 401, duration, correlationId);
    return ApiResponse.unauthorized(
      'COMMON.UNAUTHORIZED',
      { requestId: correlationId, event },
      { code: 'UNAUTHORIZED', details: [{ message: 'Organization ID not found in token' }] },
    );
  }

  try {
    logger.info({ 
      event: 'fetching_user_counts', 
      organizationId,
      source: 'ORG_USER_LIST',
      table: 'user-table-dev'
    });
    
    // Fetch and calculate user counts dynamically from actual users
    const data = await userService.getOrganizationUserCounts(
      organizationId,
      undefined, // No filters - get all user counts
      correlationId,
    );
    
    console.log('=== USER COUNTS DATA ===');
    console.log('Organization ID:', organizationId);
    console.log('Data type:', typeof data);
    console.log('Data is array:', Array.isArray(data));
    console.log('Data length:', Array.isArray(data) ? data.length : 'N/A');
    console.log('Data:', JSON.stringify(data, null, 2));
    
    logger.info({ 
      event: 'getOrganizationUserCount_success', 
      organizationId,
      dataType: typeof data,
      isArray: Array.isArray(data),
      totalRoles: Array.isArray(data) ? data.length : 0,
      sampleData: Array.isArray(data) && data.length > 0 ? data[0] : null
    });
    
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 200, duration, correlationId);
    
    return ApiResponse.ok(
      data,
      {
        title: 'Organization user count success',
        description: 'The organization user count completed successfully.',
      },
      { requestId: correlationId, event }
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'getOrganizationUserCount_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_SERVER_ERROR',
      { requestId: correlationId, event },
      { code: 'INTERNAL_SERVER_ERROR' },
    );
  }
}
