import { planOwnershipRepair } from './ownership-backfill';
import {
  planOwnershipBackfill,
  runOwnershipBackfill,
} from '../scripts/backfill-vendor-ownership';

const canonical = 'u-93ea906d-4161-4f4b-871a-3fd42fa24ccc';

describe('vendor ownership backfill', () => {
  it('realigns a generated owner index when the profile already has a canonical user id', () => {
    const plan = planOwnershipRepair({
      vendorId: 'vendor-1',
      profileOwnerUserId: canonical,
      ownerItemUserId: 'user_1791439785533',
      ownerGsi1Pk: 'OWNER#user_1791439785533',
      hasOwnerItem: true,
      unverifiedPhoneNumber: '+919876543210',
    });

    expect(plan.action).toBe('realign_index');
    expect(plan.canonicalUserId).toBe(canonical);
    expect(plan.updateProfileOwnerUserId).toBe(false);
    expect(plan.writeOwnerItem).toBe(true);
    expect(plan.unverifiedPhoneNumber).toBe('+919876543210');
    expect(plan.reason.toLowerCase()).not.toContain('matched');
  });

  it('does not infer ownership from a phone number when both ids are generated', () => {
    const [plan] = planOwnershipBackfill(
      [
        {
          entityType: 'Vendor',
          SK: 'PROFILE',
          vendorId: 'vendor-1',
          ownerUserId: 'user_1791439785533',
          phoneNumber: '+919876543210',
        },
        {
          entityType: 'VendorOwner',
          SK: 'OWNER',
          vendorId: 'vendor-1',
          userId: 'user_1791439785533',
          GSI1PK: 'OWNER#user_1791439785533',
        },
      ],
      { dryRun: true },
    );

    expect(plan.action).toBe('manual_reconciliation');
    expect(plan.canonicalUserId).toBeUndefined();
    expect(plan.unverifiedPhoneNumber).toBe('+919876543210');
  });

  it('applies only a verified vendor mapping and updates the indexed owner key', async () => {
    const items = [
      {
        entityType: 'Vendor',
        SK: 'PROFILE',
        vendorId: 'vendor-1',
        ownerUserId: 'user_1791439785533',
        phoneNumber: '+919800000000',
      },
      {
        entityType: 'VendorOwner',
        SK: 'OWNER',
        vendorId: 'vendor-1',
        userId: 'user_1791439785533',
        GSI1PK: 'OWNER#user_1791439785533',
      },
    ];
    const writes: Record<string, unknown>[][] = [];
    const report = await runOwnershipBackfill({
      items,
      tableName: 'vendor-table',
      options: {
        dryRun: false,
        now: '2026-10-08T00:00:00.000Z',
        verifiedMappings: [
          {
            vendorId: 'vendor-1',
            canonicalUserId: canonical,
            verified: true,
          },
        ],
      },
      transact: async (transactItems) => {
        writes.push(transactItems);
      },
    });

    expect(report.dryRun).toBe(false);
    expect(report.applied).toEqual(['vendor-1']);
    const ownerUpdate = writes[0].find((item) => 'Update' in item) as {
      Update: {
        Key: { SK: string };
        UpdateExpression: string;
        ExpressionAttributeValues: Record<string, string>;
      };
    };
    expect(ownerUpdate.Update.Key.SK).toBe('OWNER');
    expect(ownerUpdate.Update.UpdateExpression).toContain('GSI1PK');
    expect(ownerUpdate.Update.ExpressionAttributeValues[':gsi1pk']).toBe(
      `OWNER#${canonical}`,
    );
    expect(ownerUpdate.Update.ExpressionAttributeValues[':userId']).toBe(
      canonical,
    );
  });

  it('reports a dry run without writing', async () => {
    const transact = jest.fn();
    const report = await runOwnershipBackfill({
      items: [
        {
          entityType: 'Vendor',
          SK: 'PROFILE',
          vendorId: 'vendor-1',
          ownerUserId: canonical,
        },
        {
          entityType: 'VendorOwner',
          SK: 'OWNER',
          vendorId: 'vendor-1',
          userId: 'user_1791439785533',
          GSI1PK: 'OWNER#user_1791439785533',
        },
      ],
      tableName: 'vendor-table',
      options: { dryRun: true },
      transact,
    });

    expect(report.plans[0].action).toBe('realign_index');
    expect(report.applied).toEqual([]);
    expect(transact).not.toHaveBeenCalled();
  });

  it('leaves an unverified mapping unchanged', () => {
    const plan = planOwnershipRepair(
      {
        vendorId: 'vendor-1',
        profileOwnerUserId: 'user_1791439785533',
        ownerItemUserId: 'user_1791439785533',
        ownerGsi1Pk: 'OWNER#user_1791439785533',
        hasOwnerItem: true,
      },
      {
        verifiedMappings: [
          {
            vendorId: 'vendor-1',
            canonicalUserId: canonical,
            verified: false,
          },
        ],
      },
    );

    expect(plan.action).toBe('manual_reconciliation');
    expect(plan.updateProfileOwnerUserId).toBe(false);
  });
});
