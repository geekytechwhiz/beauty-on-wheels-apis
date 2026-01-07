import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../utils/db.config';
import { createLogger } from '@api-hub/logger';
const logger = createLogger({ service: 'user-service', redactPII: true });

export class OrganizationRepository {
  async getOrganization(organizationId: string): Promise<any | null> {
    const pk = 'ORG_LIST';
    const sk = `ORG#${organizationId}`;
    logger.info({ event: 'Fetching organization details', organizationId });
    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: process.env.OLD_USER_TABLE,
          Key: { pk, sk },
        })
      );
      return result.Item || null;
    } catch (err) {
      logger.error({ event: 'Error fetching organization details', err: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : err, organizationId });
      return null;
    }
  }
}
