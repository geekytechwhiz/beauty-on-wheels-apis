import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

import { DynamoDbAuthUserDirectory } from './dynamodb-user-directory';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('DynamoDbAuthUserDirectory', () => {
  const table = 'identity-table-test';
  let directory: DynamoDbAuthUserDirectory;

  beforeEach(() => {
    ddbMock.reset();
    process.env.DYNAMODB_TABLE_NAME = table;
    directory = new DynamoDbAuthUserDirectory(table);
  });

  afterEach(() => {
    delete process.env.DYNAMODB_TABLE_NAME;
  });

  it('resolves identityId → user', async () => {
    ddbMock
      .on(GetCommand, {
        TableName: table,
        Key: { PK: 'IDENTITY#cognito-sub-1', SK: 'LOOKUP' },
      })
      .resolves({ Item: { userId: 'u-1', identityId: 'cognito-sub-1' } })
      .on(GetCommand, {
        TableName: table,
        Key: { PK: 'USER#u-1', SK: 'META' },
      })
      .resolves({
        Item: {
          userId: 'u-1',
          identityId: 'cognito-sub-1',
          roleId: 'vendor',
          status: 'active',
        },
      });

    await expect(directory.findUserByIdentityId('cognito-sub-1')).resolves.toEqual({
      userId: 'u-1',
      identityId: 'cognito-sub-1',
      roleId: 'vendor',
      status: 'active',
    });
  });

  it('returns null when the identity lookup is missing', async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(directory.findUserByIdentityId('missing')).resolves.toBeNull();
  });

  it('falls back to user.roleId when no USER# ROLE# items exist', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(GetCommand).resolves({ Item: { userId: 'u-1', roleId: 'vendor' } });

    await expect(directory.getUserRoles('u-1')).resolves.toEqual(['vendor']);
  });

  it('unions permissions across roles', async () => {
    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: {
          ':pk': 'ROLE#vendor',
          ':skPrefix': 'PERMISSION#',
        },
      })
      .resolves({ Items: [{ permissionId: 'vendor:read' }] })
      .on(QueryCommand, {
        ExpressionAttributeValues: {
          ':pk': 'ROLE#dispatcher',
          ':skPrefix': 'PERMISSION#',
        },
      })
      .resolves({ Items: [{ permissionId: 'booking:read' }] });

    await expect(
      directory.getPermissionsForRoles(['vendor', 'dispatcher']),
    ).resolves.toEqual(['vendor:read', 'booking:read']);
  });
});
