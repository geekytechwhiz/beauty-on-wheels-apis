import { VendorsRepository } from './vendors.repository';

describe('VendorsRepository', () => {
  it('normalizes discovery keys in the final create transaction item', async () => {
    const repository = new VendorsRepository();
    const transactWrite = jest.spyOn(repository as never, 'transactWrite' as never)
      .mockResolvedValue(undefined);
    const profile = {
      PK: 'VENDOR#vendor-1', SK: 'PROFILE', vendorId: 'vendor-1', createdBy: 'staff-1',
      status: 'PENDING_VERIFICATION', operationalStatus: 'OFFLINE', onboardingStatus: 'DRAFT',
      currentSection: 'BUSINESS_INFO', completedSections: [], createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z', GSI1PK: 'wrong', GSI1SK: 'wrong', entityType: 'Vendor',
    } as const;

    await repository.createVendor(profile);

    const request = transactWrite.mock.calls[0][0] as {
      TransactItems: Array<{ Put: { Item: typeof profile } }>;
    };
    expect(request.TransactItems[0].Put.Item).toMatchObject({
      GSI1PK: 'VENDOR',
      GSI1SK: 'STATUS#PENDING_VERIFICATION#OPERATIONAL#OFFLINE#2026-01-01T00:00:00.000Z#vendor-1',
    });
  });

  it('uses the vendor discovery partition for the unfiltered admin listing', async () => {
    const repository = new VendorsRepository();
    const queryPage = jest.spyOn(repository as never, 'queryPage' as never)
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repository.listVendors();

    expect(queryPage).toHaveBeenCalledWith(expect.objectContaining({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: { ':gsi1pk': 'VENDOR' },
    }));
  });
});
