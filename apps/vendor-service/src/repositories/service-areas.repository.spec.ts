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
import { ConditionalWriteConflictError } from '@api-hub/utils';

import { ServiceAreasRepository } from './service-areas.repository';
import { ServiceAreaDdbItem } from '../types/repository.types';

const ddbMock = mockClient(DynamoDBDocumentClient);

const item: ServiceAreaDdbItem = {
  PK: 'VENDOR#vendor-1',
  SK: 'SERVICE_AREA#area-1',
  serviceAreaId: 'area-1',
  vendorId: 'vendor-1',
  name: 'Indiranagar',
  city: 'Bengaluru',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  entityType: 'ServiceArea',
};

describe('ServiceAreasRepository', () => {
  let repository: ServiceAreasRepository;

  beforeEach(() => {
    ddbMock.reset();
    repository = new ServiceAreasRepository();
  });

  it('creates a service area under the vendor partition with a vendor existence check', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    await repository.createServiceArea(item);

    const call = ddbMock.call(0);
    const input = call.args[0].input as {
      TransactItems: Array<Record<string, any>>;
    };
    expect(input.TransactItems).toHaveLength(2);
    expect(input.TransactItems[0].ConditionCheck.Key).toEqual({
      PK: 'VENDOR#vendor-1',
      SK: 'PROFILE',
    });
    expect(input.TransactItems[1].Put.Item.SK).toBe('SERVICE_AREA#area-1');
    expect(input.TransactItems[1].Put.Item.GSI1PK).toBeUndefined();
    expect(input.TransactItems[1].Put.Item.GSI2PK).toBeUndefined();
  });

  it('gets a service area by vendor-owned primary key', async () => {
    ddbMock.on(GetCommand).resolves({ Item: item });

    const result = await repository.getServiceArea('vendor-1', 'area-1');

    expect(result?.serviceAreaId).toBe('area-1');
    const input = ddbMock.call(0).args[0].input as {
      Key: { PK: string; SK: string };
    };
    expect(input.Key).toEqual({
      PK: 'VENDOR#vendor-1',
      SK: 'SERVICE_AREA#area-1',
    });
  });

  it('lists service areas with a begins_with query on the vendor partition', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [item] });

    const result = await repository.listServiceAreas('vendor-1');

    expect(result).toHaveLength(1);
    const input = ddbMock.call(0).args[0].input as {
      KeyConditionExpression: string;
      ExpressionAttributeValues: Record<string, string>;
      IndexName?: string;
    };
    expect(input.IndexName).toBeUndefined();
    expect(input.KeyConditionExpression).toContain('begins_with(SK, :skPrefix)');
    expect(input.ExpressionAttributeValues[':pk']).toBe('VENDOR#vendor-1');
    expect(input.ExpressionAttributeValues[':skPrefix']).toBe('SERVICE_AREA#');
  });

  it('deletes a service area by vendor-owned key', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    await repository.deleteServiceArea('vendor-1', 'area-1');

    const input = ddbMock.call(0).args[0].input as {
      TransactItems: Array<Record<string, any>>;
    };
    expect(input.TransactItems[0].Delete.Key).toEqual({
      PK: 'VENDOR#vendor-1',
      SK: 'SERVICE_AREA#area-1',
    });
  });

  it('maps conditional write failures', async () => {
    const err = new Error('ConditionalCheckFailed');
    err.name = 'TransactionCanceledException';
    (err as any).CancellationReasons = [{ Code: 'ConditionalCheckFailed' }];
    ddbMock.on(TransactWriteCommand).rejects(err);

    await expect(repository.createServiceArea(item)).rejects.toThrow(
      ConditionalWriteConflictError,
    );
  });
});
