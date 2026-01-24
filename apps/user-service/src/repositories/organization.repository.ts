import axios from 'axios';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../utils/db.config';
import { createLogger, createChildLogger } from '@api-hub/logger';
const logger = createLogger({ service: 'user-service', redactPII: true });

const ORGANIZATION_TABLE_NAME = process.env.ORGANIZATION_TABLE || process.env.USER_TABLE || '';

export class OrganizationRepository {
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
      const result = await docClient.send(
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

  async getOrganization(organizationId: string, authHeader?: string): Promise<any | null> {
    const apiBaseUrl = process.env.ORGANIZATION_API_URL;
    logger.info({ event: 'Fetching organization details', organizationId });
    if (!apiBaseUrl) {
      logger.error({ event: 'Organization API URL not configured', organizationId });
      return null;
    }

    try {
      const url = `${apiBaseUrl.replace(/\/$/, '')}/organization/${organizationId}`;
      const response = await axios.get(url, {
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
      });
      const payload = response.data?.data || response.data || null;
      logger.info({
        event: 'Organization API response',
        status: response.status,
        organizationId,
        hasData: payload !== null,
      });
      return payload;
    } catch (err) {
      const error = err as any;
      const status = error?.response?.status;
      logger.error({
        event: 'Error fetching organization details',
        err: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : err,
        status,
        organizationId,
      });
      return null;
    }
  }
}
