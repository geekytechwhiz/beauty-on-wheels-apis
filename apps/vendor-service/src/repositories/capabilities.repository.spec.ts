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
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

import { CapabilitiesRepository } from './capabilities.repository';
import { VendorCapabilitiesDdbItem } from '../types/repository.types';

const ddbMock = mockClient(DynamoDBDocumentClient);

const item: VendorCapabilitiesDdbItem = {
  PK: 'VENDOR#vendor-1',
  SK: 'CAPABILITIES',
  vendorId: 'vendor-1',
  vehicleTypes: ['SEDAN'],
  serviceIds: ['svc-1'],
  packageIds: ['pkg-1'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  entityType: 'VendorCapabilities',
};

describe('CapabilitiesRepository', () => {
  let repository: CapabilitiesRepository;

  beforeEach(() => {
    ddbMock.reset();
    repository = new CapabilitiesRepository();
  });

  it('gets capabilities from the vendor singleton item', async () => {
    ddbMock.on(GetCommand).resolves({ Item: item });

    const result = await repository.getCapabilities('vendor-1');

    expect(result?.serviceIds).toEqual(['svc-1']);
    const input = ddbMock.call(0).args[0].input as {
      Key: { PK: string; SK: string };
    };
    expect(input.Key).toEqual({
      PK: 'VENDOR#vendor-1',
      SK: 'CAPABILITIES',
    });
  });

  it('replaces capabilities as catalog id references only', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    await repository.putCapabilities(item);

    const input = ddbMock.call(0).args[0].input as {
      TransactItems: Array<Record<string, any>>;
    };
    expect(input.TransactItems[0].ConditionCheck.Key).toEqual({
      PK: 'VENDOR#vendor-1',
      SK: 'PROFILE',
    });
    expect(input.TransactItems[1].Put.Item.serviceIds).toEqual(['svc-1']);
    expect(input.TransactItems[1].Put.Item.packageIds).toEqual(['pkg-1']);
    expect(input.TransactItems[1].Put.Item.name).toBeUndefined();
    expect(input.TransactItems[1].Put.Item.basePrice).toBeUndefined();
  });
});
