import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'; 
import { USER_TABLE, USER_BASIC_DETAILS, USER } from '../../utils/constants';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

async function organizationDetails(orgId: string) {
  const params = {
    TableName: USER_TABLE,
    KeyConditionExpression: '#pk = :pk AND #sk = :sk',
    FilterExpression: '#deleteFlag <> :deleted',
    ExpressionAttributeNames: {
      '#pk': 'pk',
      '#sk': 'sk',
      '#deleteFlag': 'deleteFlag',
    },
    ExpressionAttributeValues: {
      ':pk': 'ORG_LIST',
      ':sk': `ORG#${orgId}`,
      ':deleted': '1',
    },
  };
  try {
    const res = await docClient.send(new QueryCommand(params));
    return res.Count && res.Count > 0 ? res.Items?.[0] : null;
  } catch (err) {
    console.error('Error fetching organizationDetails:', err);
    throw err;
  }
}


// Helper to fetch user basic details (query all USER_BASIC_DETAILS# record)
async function fetchUserBasicDetails (userId: string) {
    const params = {
        TableName: USER_TABLE,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
            '#pk': 'pk',
            '#sk': 'sk'
        },
        ExpressionAttributeValues: {
            ':pk': `${USER}#${userId}`,
            ':skPrefix': `${USER_BASIC_DETAILS}#`,
        }
    };
    try {
      const res = await docClient.send(new QueryCommand(params));
      console.log('fetchUserBasicDetails DynamoDB result:', JSON.stringify(res.Items));
      if (res.Items && res.Items.length > 0) {
        // Items are already native JS objects with DocumentClient
        return res.Items[0];
      }
      return null;
    } catch (err) {
      console.error('Error fetching patient details:', err);
      throw err;
    }
}

export { fetchUserBasicDetails };
export { organizationDetails };


