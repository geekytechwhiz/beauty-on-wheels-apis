import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { validateListOrganizationUsersPost } from '../validation/request.validators';

const client = new DynamoDBClient({ region: process.env.DEFAULT_AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);
const USER_TABLE_NAME = process.env.USER_TABLE || 'user-table-dev';

const handler = async (req: LambdaRequest<any> & { validatedListOrganizationUsersPost?: { organizationID: string; limit?: number; type?: 'STAFF' | 'USER' | 'FNF' } }) => {
  const { organizationID, limit, type } = req.validatedListOrganizationUsersPost!;
  const pk = `ORG#${organizationID}`;

  let queryParams: any = {
    TableName: USER_TABLE_NAME,
    ExpressionAttributeValues: { ':pk': pk },
  };

  if (type) {
    const typeUpper = String(type).toUpperCase();
    queryParams.KeyConditionExpression = 'pk = :pk AND begins_with(sk, :typePrefix)';
    queryParams.ExpressionAttributeValues[':typePrefix'] = `${typeUpper}#`;
  } else {
    queryParams.KeyConditionExpression = 'pk = :pk';
  }

  if (limit && typeof limit === 'number' && limit > 0) {
    queryParams.Limit = limit;
  }

  const result = await docClient.send(new QueryCommand(queryParams));
  const items = result.Items || [];
  return { items };
};

export const main = withLambdaHandler(handler, {
  validator: validateListOrganizationUsersPost,
});
