import { mapVendorEmailVerifiedStreamRecord } from './map-vendor-email-verified-stream';

const complete = [
  'BUSINESS_INFO', 'OWNER_DETAILS', 'ADDRESS', 'BRANCH', 'DOCUMENTS', 'BANK_DETAILS',
];

function record(overrides: Record<string, unknown> = {}) {
  return {
    eventID: 'stream-1',
    eventName: 'MODIFY',
    dynamodb: {
      OldImage: { entityType: { S: 'Vendor' } },
      NewImage: {
        entityType: { S: 'Vendor' },
        vendorId: { S: 'vendor-1' },
        ownerUserId: { S: 'user-1' },
        emailVerifiedAt: { S: '2026-10-09T00:00:00.000Z' },
        completedSections: { L: complete.map((section) => ({ S: section })) },
        ...overrides,
      },
    },
  };
}

describe('mapVendorEmailVerifiedStreamRecord', () => {
  it('publishes a trusted role-assignment event only after verified completed onboarding', () => {
    const event = mapVendorEmailVerifiedStreamRecord(record());
    expect(event.eventType).toBe('Vendor.EmailVerified');
    expect(event.payload).toEqual({ vendorId: 'vendor-1', userId: 'user-1', emailVerified: true });
    expect(event.idempotencyKey).toBe('Vendor.EmailVerified:vendor-1:2026-10-09T00:00:00.000Z');
  });

  it('rejects a verified email if onboarding is incomplete', () => {
    expect(() => mapVendorEmailVerifiedStreamRecord(record({
      completedSections: { L: complete.slice(0, -1).map((section) => ({ S: section })) },
    }))).toThrow();
  });
});
