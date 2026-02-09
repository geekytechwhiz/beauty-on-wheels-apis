import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { 
  createLogger, 
  extractCorrelationId, 
  serializeError, 
  logHttpRequest, 
  extractAwsRequestId, 
  createChildLogger 
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { listOrganizationUsersPostSchema } from '../validation/listOrganizationUsersPost.validation';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

const client = new DynamoDBClient({ region: process.env.DEFAULT_AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const USER_TABLE_NAME = process.env.USER_TABLE || 'user-table-dev';

/**
 * Handler for POST /organization/users
 * 
 * Supports two scenarios:
 * 1. { "organizationID": "...", "type": "STAFF" } - Filter by user type
 * 2. { "organizationID": "...", "limit": 10 } - Apply limit
 */
export const main = async (
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  const logger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });

  logger.info({ event: 'listOrganizationUsersPost_received' });

  try {
    // Parse and validate request body
    const body = event.body ? JSON.parse(event.body) : {};
    
    const validation = listOrganizationUsersPostSchema.safeParse(body);
    
    if (!validation.success) {
      logger.warn({ 
        event: 'listOrganizationUsersPost_validation_failed',
        errors: validation.error.issues,
      });
      const duration = Date.now() - startTime;
      logHttpRequest(
        logger,
        event.httpMethod || 'POST',
        event.path || '/organization/users',
        400,
        duration,
        correlationId,
      );
      return ApiResponse.badRequest(
        'COMMON.VALIDATION_ERROR',
        { requestId: correlationId, event },
        { 
          code: 'VALIDATION_ERROR', 
          details: validation.error.issues.map(issue => ({ 
            message: issue.message,
            path: issue.path.join('.'),
          })),
        },
      );
    }

    const { organizationID, limit, type } = validation.data;

    logger.info({
      event: 'listOrganizationUsersPost_params',
      organizationID,
      limit,
      type,
    });

    // Build DynamoDB query
    // pk: "ORG_USER_LIST#mlafkq5y9996dbbb", sk: "STAFF#01KGRS2BXNN2T01BB9VXWSN7ND"
    const pk = `ORG#${organizationID}`;

    let queryParams: any = {
      TableName: USER_TABLE_NAME,
      ExpressionAttributeValues: {
        ':pk': pk,
      },
    };

    // Scenario 1: Filter by type (e.g., "STAFF", "USER", "FNF")
    if (type) {
      const typeUpper = String(type).toUpperCase();
      queryParams.KeyConditionExpression = 'pk = :pk AND begins_with(sk, :typePrefix)';
      queryParams.ExpressionAttributeValues[':typePrefix'] = `${typeUpper}#`;
      
      logger.info({ 
        event: 'listOrganizationUsersPost_filter_by_type',
        type: typeUpper,
        skPrefix: `${typeUpper}#`,
      });
    } else {
      // Query all users
      queryParams.KeyConditionExpression = 'pk = :pk';
      logger.info({ event: 'listOrganizationUsersPost_query_all_users' });
    }

    // Scenario 2: Apply limit
    if (limit && typeof limit === 'number' && limit > 0) {
      queryParams.Limit = limit;
      logger.info({ event: 'listOrganizationUsersPost_apply_limit', limit });
    }

    logger.info({ 
      event: 'listOrganizationUsersPost_query',
      pk,
      hasTypeFilter: !!type,
      hasLimit: !!limit,
    });

    // Execute query
    const result = await docClient.send(new QueryCommand(queryParams));

    const items = result.Items || [];
    
    logger.info({ 
      event: 'listOrganizationUsersPost_success',
      count: items.length,
      organizationID,
    });

    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'POST',
      event.path || '/organization/users',
      200,
      duration,
      correlationId,
    );

    return ApiResponse.ok(
      { items },
      {
        title: 'User list success',
        description: 'The user list completed successfully.',
      },
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'listOrganizationUsersPost_error', err: serializeError(err) });
    logHttpRequest(
      logger,
      event.httpMethod || 'POST',
      event.path || '/organization/users',
      500,
      duration,
      correlationId,
    );

    return ApiResponse.internalServerError(
      {
        title: 'User list failed',
        description: 'Failed to retrieve user list.',
      },
      { requestId: correlationId, event },
      { 
        code: 'LIST_ORG_USERS_FAILED', 
        details: [{ message: (err as Error)?.message || 'Unknown error' }] 
      },
    );
  }
};
