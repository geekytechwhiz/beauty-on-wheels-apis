import {
  VendorOnboardingSubmittedEvent,
  VENDOR_ONBOARDING_EVENT_TYPE,
  VENDOR_ONBOARDING_EVENT_VERSION,
  VENDOR_ONBOARDING_EVENT_SOURCE,
  vendorOnboardingSubmittedIdempotencyKey,
} from './vendor-onboarding.events';
import { getRegisteredEventDefinition } from '../../governance/event-registry';
import { getSchemaMeta } from '../schema/schema-meta';

describe('VendorOnboardingSubmittedEvent', () => {
  it('is registered with stable type, version, and source', () => {
    const meta = getSchemaMeta(VendorOnboardingSubmittedEvent);
    expect(meta.eventType).toBe(VENDOR_ONBOARDING_EVENT_TYPE);
    expect(meta.eventVersion).toBe(VENDOR_ONBOARDING_EVENT_VERSION);
    expect(meta.source).toBe(VENDOR_ONBOARDING_EVENT_SOURCE);
    expect(meta.transport).toBe('eventbridge');

    const registered = getRegisteredEventDefinition(VENDOR_ONBOARDING_EVENT_TYPE);
    expect(registered?.eventVersion).toBe(VENDOR_ONBOARDING_EVENT_VERSION);
    expect(registered?.classification).toBe('domain');
  });

  it('accepts the minimal vendor identifiers required by email delivery', () => {
    const parsed = VendorOnboardingSubmittedEvent.parse({
      applicationId: 'app-1',
      vendorId: 'vendor-1',
      ownerUserId: 'user-1',
      email: 'owner@example.com',
      onboardingStatus: 'PENDING_REVIEW',
    });

    expect(parsed.applicationId).toBe('app-1');
    expect(parsed.email).toBe('owner@example.com');
  });

  it('rejects an invalid email', () => {
    expect(() =>
      VendorOnboardingSubmittedEvent.parse({
        applicationId: 'app-1',
        vendorId: 'vendor-1',
        ownerUserId: 'user-1',
        email: 'not-an-email',
        onboardingStatus: 'PENDING_REVIEW',
      }),
    ).toThrow();
  });

  it('builds a stable business idempotency key', () => {
    expect(vendorOnboardingSubmittedIdempotencyKey('app-1')).toBe(
      'VendorOnboarding.Submitted:app-1',
    );
  });
});
