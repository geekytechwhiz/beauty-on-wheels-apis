jest.mock('../configs/env.config', () => ({
  env: {
    DYNAMODB_TABLE_NAME: 'vendor-service-test-vendor',
    SERVICE_NAME: 'vendor-service',
    LOG_LEVEL: 'info',
    EVENT_BUS_NAME: '',
  },
}));

import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

import { StaffRepository } from './staff.repository';
import { StaffDdbItem } from '../types/repository.types';

const ddbMock = mockClient(DynamoDBDocumentClient);

const item: StaffDdbItem = {
  PK: 'VENDOR#vendor-1',
  SK: 'STAFF#staff-1',
  staffId: 'staff-1',
  vendorId: 'vendor-1',
  name: 'Ananya Reddy',
  phoneNumber: '+919900112233',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  entityType: 'Staff',
};

describe('StaffRepository', () => {
  let repository: StaffRepository;

  beforeEach(() => {
    ddbMock.reset();
    repository = new StaffRepository();
  });

  it('creates staff under the vendor partition without a User profile item', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    await repository.createStaff(item);

    const input = ddbMock.call(0).args[0].input as {
      TransactItems: Array<Record<string, any>>;
    };
    expect(input.TransactItems).toHaveLength(2);
    expect(input.TransactItems[0].ConditionCheck.Key.SK).toBe('PROFILE');
    expect(input.TransactItems[1].Put.Item.entityType).toBe('Staff');
    expect(input.TransactItems[1].Put.Item.SK).toBe('STAFF#staff-1');
    expect(input.TransactItems[1].Put.Item.userId).toBeUndefined();
  });

  it('gets staff by vendor-owned primary key', async () => {
    ddbMock.on(GetCommand).resolves({ Item: item });

    const result = await repository.getStaff('vendor-1', 'staff-1');

    expect(result?.staffId).toBe('staff-1');
    const input = ddbMock.call(0).args[0].input as {
      Key: { PK: string; SK: string };
    };
    expect(input.Key).toEqual({
      PK: 'VENDOR#vendor-1',
      SK: 'STAFF#staff-1',
    });
  });

  it('lists staff with a begins_with query on the vendor partition', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [item] });

    const result = await repository.listStaff({ vendorId: 'vendor-1', limit: 20 });

    expect(result.items).toHaveLength(1);
    const input = ddbMock.call(0).args[0].input as {
      KeyConditionExpression: string;
      ExpressionAttributeValues: Record<string, string>;
      IndexName?: string;
    };
    expect(input.IndexName).toBeUndefined();
    expect(input.ExpressionAttributeValues[':skPrefix']).toBe('STAFF#');
  });

  it('finds staff by associated portal userId within the vendor partition', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ ...item, userId: 'portal-1' }] });

    const result = await repository.findStaffByUserId('vendor-1', 'portal-1');

    expect(result?.userId).toBe('portal-1');
    const input = ddbMock.call(0).args[0].input as {
      FilterExpression?: string;
    };
    expect(input.FilterExpression).toContain('userId');
  });
});
