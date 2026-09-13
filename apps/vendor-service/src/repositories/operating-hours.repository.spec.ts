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

import { OperatingHoursRepository } from './operating-hours.repository';
import { VendorOperatingHoursDdbItem } from '../types/repository.types';

const ddbMock = mockClient(DynamoDBDocumentClient);

const item: VendorOperatingHoursDdbItem = {
  PK: 'VENDOR#vendor-1',
  SK: 'HOURS',
  vendorId: 'vendor-1',
  operatingHours: [
    {
      dayOfWeek: 'MONDAY',
      closed: false,
      openTime: '09:00',
      closeTime: '18:00',
    },
    { dayOfWeek: 'SUNDAY', closed: true },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  entityType: 'VendorOperatingHours',
};

describe('OperatingHoursRepository', () => {
  let repository: OperatingHoursRepository;

  beforeEach(() => {
    ddbMock.reset();
    repository = new OperatingHoursRepository();
  });

  it('gets operating hours from the vendor singleton item', async () => {
    ddbMock.on(GetCommand).resolves({ Item: item });

    const result = await repository.getOperatingHours('vendor-1');

    expect(result?.operatingHours).toHaveLength(2);
    const input = ddbMock.call(0).args[0].input as {
      Key: { PK: string; SK: string };
    };
    expect(input.Key).toEqual({
      PK: 'VENDOR#vendor-1',
      SK: 'HOURS',
    });
  });

  it('replaces operating hours under the vendor partition', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    await repository.putOperatingHours(item);

    const input = ddbMock.call(0).args[0].input as {
      TransactItems: Array<Record<string, any>>;
    };
    expect(input.TransactItems[0].ConditionCheck.Key).toEqual({
      PK: 'VENDOR#vendor-1',
      SK: 'PROFILE',
    });
    expect(input.TransactItems[1].Put.Item.SK).toBe('HOURS');
    expect(input.TransactItems[1].Put.Item.entityType).toBe(
      'VendorOperatingHours',
    );
    expect(input.TransactItems[1].Put.Item.operatingHours).toEqual(
      item.operatingHours,
    );
  });
});
