import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../utils/db.config';

export class OrganizationRepository {
  async getOrganization(organizationId: string): Promise<any | null> {
    const pk = `ORG#${organizationId}`;
    const sk = 'ORG_DETAILS';
    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: process.env.OLD_USER_TABLE,
          Key: { pk, sk },
        })
      );
      return result.Item || null;
    } catch (err) {
      // Optionally log error
      return null;
    }
  }
}
