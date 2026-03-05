import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'; 
import { ddbDocClient } from '@api-hub/utils';
import { createLogger, createChildLogger } from '@api-hub/logger';
const logger = createLogger({ service: 'user-service', redactPII: true });

const ORGANIZATION_TABLE_NAME = process.env.ORGANIZATION_TABLE || process.env.USER_TABLE || '';

export class OrganizationRepository {
  /**
   * Fetches organization basic details from USER_TABLE (matches original getOrgBasicDetails)
   * Queries: pk = ORG_LIST, sk = ORG#organizationId
   */
  async getOrgBasicDetails(organizationId: string): Promise<any | null> {
    const childLogger = createChildLogger(logger, { organizationId });
    childLogger.info({ event: 'getOrgBasicDetails_start', organizationId });

    if (!ORGANIZATION_TABLE_NAME) {
      childLogger.error({ event: 'Organization table name not configured' });
      return null;
    }

    try {
      const params = {
        TableName: ORGANIZATION_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND #sk = :sk',
        FilterExpression: '#deleteFlag <> :deleteFlag',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
          '#deleteFlag': 'deleteFlag',
        },
        ExpressionAttributeValues: {
          ':pk': 'ORG_LIST',
          ':sk': `ORG#${organizationId}`,
          ':deleteFlag': '1',
        },
      };

      const result = await ddbDocClient.send(new QueryCommand(params));
      if (result.Items && result.Items.length > 0) {
        childLogger.info({ event: 'getOrgBasicDetails_success', organizationId });
        return result.Items[0];
      }
      childLogger.info({ event: 'getOrgBasicDetails_not_found', organizationId });
      return null;
    } catch (err) {
      childLogger.error({
        event: 'getOrgBasicDetails_error',
        err: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : err,
        organizationId,
      });
      return null;
    }
  }

  /**
   * Fetches organization details directly from DynamoDB table
   */
  async getOrganizationFromDB(organizationId: string): Promise<any | null> {
    const childLogger = createChildLogger(logger, { organizationId });
    childLogger.info({ event: 'Fetching organization from DB', organizationId });

    if (!ORGANIZATION_TABLE_NAME) {
      childLogger.error({ event: 'Organization table name not configured' });
      return null;
    }

    try {
      const result = await ddbDocClient.send(
        new GetCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Key: {
            pk: `ORG#${organizationId}`,
            sk: 'ORG_DETAILS',
          },
        }),
      );

      if (!result.Item) {
        childLogger.info({ event: 'Organization not found in DB', organizationId });
        return null;
      }

      childLogger.info({ event: 'Organization fetched from DB successfully', organizationId });
      return result.Item;
    } catch (err) {
      childLogger.error({
        event: 'Error fetching organization from DB',
        err: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : err,
        organizationId,
      });
      return null;
    }
  }
}
