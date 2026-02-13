/**
 * Legacy user details from DynamoDB (USER_TABLE).
 * Used to validate session (lastUsedAccount, logoutAt, tokenUpdatedAt) and to build authorizer context.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const USER_PREFIX = 'USER#';
const USER_BASIC_DETAILS_PREFIX = 'USER_BASIC_DETAILS#';

export interface UserDetails {
  emailAddress?: string;
  phoneNumber?: string;
  userID: string;
  organizationID: string;
  userType?: string;
  defaultProfile?: string;
  lastUsedAccount?: number;
  logoutAt?: number;
  tokenUpdatedAt?: number;
  [key: string]: unknown;
}

let docClient: DynamoDBDocumentClient | null = null;

function getDocClient(): DynamoDBDocumentClient {
  if (docClient == null) {
    const client = new DynamoDBClient({
      region: process.env.REGION ?? process.env.AWS_REGION ?? 'us-east-1',
    });
    docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}

/**
 * Fetches user basic details by userID and organizationID (legacy pk/sk pattern).
 */
export async function getUserDetails(
  userTable: string,
  userID: string,
  organizationID: string
): Promise<UserDetails | null> {
  if (!userTable?.trim() || !userID?.trim() || !organizationID?.trim()) {
    return null;
  }
  const client = getDocClient();
  const result = await client.send(
    new QueryCommand({
      TableName: userTable,
      KeyConditionExpression: '#pk = :pk AND #sk = :sk',
      ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
      ExpressionAttributeValues: {
        ':pk': `${USER_PREFIX}${userID}`,
        ':sk': `${USER_BASIC_DETAILS_PREFIX}${organizationID}`,
      },
    })
  );
  const items = result.Items;
  if (items == null || items.length === 0) {
    return null;
  }
  const item = items[0] as Record<string, unknown>;
  return {
    userID,
    organizationID,
    emailAddress: item.emailAddress as string | undefined,
    phoneNumber: item.phoneNumber as string | undefined,
    userType: item.userType as string | undefined,
    defaultProfile: item.defaultProfile as string | undefined,
    lastUsedAccount: item.lastUsedAccount as number | undefined,
    logoutAt: item.logoutAt as number | undefined,
    tokenUpdatedAt: item.tokenUpdatedAt as number | undefined,
    ...item,
  };
}

/**
 * Validates legacy session: user must exist, lastUsedAccount >= logoutAt, tokenUpdatedAt <= tokenGeneratedTime.
 */
export function isLegacySessionValid(
  userDetails: UserDetails | null,
  tokenGeneratedTime: number | undefined
): boolean {
  if (userDetails == null) {
    return false;
  }
  const lastUsed = userDetails.lastUsedAccount ?? 0;
  const logoutAt = userDetails.logoutAt ?? 0;
  if (lastUsed < logoutAt) {
    return false;
  }
  if (tokenGeneratedTime != null) {
    const tokenUpdatedAt = userDetails.tokenUpdatedAt;
    if (tokenUpdatedAt != null && tokenUpdatedAt > tokenGeneratedTime) {
      return false;
    }
  }
  return true;
}
