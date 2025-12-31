import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../utils/db.config';
import { logger } from '@api-hub/logger';

export class OrganizationRepository {
  async getOrganization(organizationId: string): Promise<any | null> {
    const pk = `ORG#${organizationId}`;
    const sk = 'ORG_DETAILS';
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
