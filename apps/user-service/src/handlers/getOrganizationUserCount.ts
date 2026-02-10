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
  
  // Extract organizationID from authorizer (handle different structures)
  const authorizer = (event.requestContext as { authorizer?: Record<string, unknown> } | undefined)?.authorizer;
  
  // Debug logging
  logger.info({ 
    event: 'authorizer_debug', 
    authorizer: authorizer,
    authorizerKeys: authorizer ? Object.keys(authorizer) : []
  });
  
  // Extract organizationID from token - try multiple paths
  let requestOrgId: string | undefined;
  
  // Path 1: From claims['custom:organizationID'] - YOUR TOKEN FORMAT (Cognito custom attribute)
  if (authorizer?.claims) {
    const claims = authorizer.claims as Record<string, unknown>;
    requestOrgId = (claims['custom:organizationID'] as string) ?? 
                   (claims['custom:organizationId'] as string);
  }
  
  // Path 2: From claims.organizationID (standard Cognito claim)
  if (!requestOrgId && authorizer?.claims) {
    const claims = authorizer.claims as Record<string, unknown>;
    requestOrgId = (claims.organizationID as string) ?? (claims.organizationId as string);
  }
  
  // Path 3: Direct from authorizer (custom authorizer)
  if (!requestOrgId && authorizer) {
    requestOrgId = (authorizer.organizationID as string) ?? (authorizer.organizationId as string);
  }
  
  logger.info({ 
    event: 'organizationId_extracted', 
    requestOrgId,
    source: requestOrgId ? 'claims[custom:organizationID]' : 'not_found'
  });
  
  // Use organizationId from token only
  const organizationId = requestOrgId;
  console.log('organizationId', organizationId, requestOrgId);
  if (!organizationId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 401, duration, correlationId);
    return ApiResponse.unauthorized(
      'COMMON.UNAUTHORIZED',
      { requestId: correlationId, event },
      { code: 'UNAUTHORIZED', details: [{ message: 'Organization ID not found in token' }] },
    );
  }
  
  logger.info({ 
    event: 'organizationId_confirmed', 
    organizationId 
  });

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
