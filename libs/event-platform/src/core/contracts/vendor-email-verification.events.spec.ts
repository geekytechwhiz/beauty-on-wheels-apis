import {
  VendorEmailVerificationRequestedEvent,
  VendorEmailVerifiedEvent,
  VENDOR_EMAIL_VERIFICATION_EVENT_TYPE,
  VENDOR_EMAIL_VERIFICATION_EVENT_VERSION,
  VENDOR_EMAIL_VERIFICATION_EVENT_SOURCE,
  vendorEmailVerificationRequestedIdempotencyKey,
  vendorEmailVerifiedIdempotencyKey,
} from './vendor-email-verification.events';
import { getRegisteredEventDefinition } from '../../governance/event-registry';
import { getSchemaMeta } from '../schema/schema-meta';

describe('VendorEmailVerificationRequestedEvent', () => {
  it('is registered with stable type, version, and source', () => {
    const meta = getSchemaMeta(VendorEmailVerificationRequestedEvent);
    expect(meta.eventType).toBe(VENDOR_EMAIL_VERIFICATION_EVENT_TYPE);
    expect(meta.eventVersion).toBe(VENDOR_EMAIL_VERIFICATION_EVENT_VERSION);
    expect(meta.source).toBe(VENDOR_EMAIL_VERIFICATION_EVENT_SOURCE);
    expect(meta.transport).toBe('eventbridge');

    const registered = getRegisteredEventDefinition(
      VENDOR_EMAIL_VERIFICATION_EVENT_TYPE,
    );
    expect(registered?.eventVersion).toBe(
      VENDOR_EMAIL_VERIFICATION_EVENT_VERSION,
    );
    expect(registered?.classification).toBe('domain');
  });

  it('accepts the vendor identifiers required by email delivery', () => {
    const parsed = VendorEmailVerificationRequestedEvent.parse({
      vendorId: 'vendor-1',
      verificationRequestId: 'verify-1',
      intent: 'VENDOR_EMAIL_VERIFICATION',
      ownerUserId: 'user-1',
      email: 'owner@example.com',
      ownerName: 'Priya',
      businessName: 'ABC Car Wash',
      verificationToken: 'vendor-1.token',
      expiryMinutes: 10,
      vendorStatus: 'PENDING_VERIFICATION',
    });

    expect(parsed.email).toBe('owner@example.com');
    expect(parsed.ownerName).toBe('Priya');
    expect(parsed.businessName).toBe('ABC Car Wash');
    expect(parsed.expiryMinutes).toBe(10);
  });

  it('rejects an invalid email', () => {
    expect(() =>
      VendorEmailVerificationRequestedEvent.parse({
        vendorId: 'vendor-1',
        verificationRequestId: 'verify-1',
        intent: 'VENDOR_EMAIL_VERIFICATION',
        ownerUserId: 'user-1',
        email: 'not-an-email',
        ownerName: 'Priya', businessName: 'ABC Car Wash', verificationToken: 'vendor-1.token',
        expiryMinutes: 10,
        vendorStatus: 'PENDING_VERIFICATION',
      }),
    ).toThrow();
  });

  it('does not accept a template identifier from producers', () => {
    const parsed = VendorEmailVerificationRequestedEvent.safeParse({
      vendorId: 'vendor-1',
      verificationRequestId: 'verify-1',
      intent: 'VENDOR_EMAIL_VERIFICATION',
      ownerUserId: 'user-1',
      email: 'owner@example.com',
      ownerName: 'Priya', businessName: 'ABC Car Wash', verificationToken: 'vendor-1.token',
      expiryMinutes: 10,
      vendorStatus: 'PENDING_VERIFICATION',
      templateId: 'untrusted-template',
    });

    expect(parsed.success).toBe(false);
  });

  it('builds a stable business idempotency key', () => {
    expect(
      vendorEmailVerificationRequestedIdempotencyKey(
        'vendor-1',
        '2026-01-01T00:00:00.000Z',
      ),
    ).toBe(
      'VendorEmailVerification.Requested:vendor-1:2026-01-01T00:00:00.000Z',
    );
  });
});

describe('VendorEmailVerifiedEvent', () => {
  it('accepts only the trusted role-assignment payload', () => {
    expect(VendorEmailVerifiedEvent.parse({
      vendorId: 'vendor-1',
      userId: 'user-1',
      emailVerified: true,
    })).toEqual({ vendorId: 'vendor-1', userId: 'user-1', emailVerified: true });
    expect(VendorEmailVerifiedEvent.safeParse({
      vendorId: 'vendor-1', userId: 'user-1', emailVerified: false,
    }).success).toBe(false);
  });

  it('uses the verification transition timestamp as its idempotency boundary', () => {
    expect(vendorEmailVerifiedIdempotencyKey('vendor-1', '2026-10-09T00:00:00.000Z'))
      .toBe('Vendor.EmailVerified:vendor-1:2026-10-09T00:00:00.000Z');
  });
});
