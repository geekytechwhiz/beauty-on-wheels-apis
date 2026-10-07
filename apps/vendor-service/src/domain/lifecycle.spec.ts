import {
  decideVendorStatusTransition,
  assertOperationalStatusAllowed,
} from './lifecycle';

describe('vendor lifecycle', () => {
  it('approves only from pending verification after review', () => {
    expect(
      decideVendorStatusTransition({
        from: 'PENDING_VERIFICATION',
        to: 'ACTIVE',
        onboardingStatus: 'PENDING_REVIEW',
      }).kind,
    ).toBe('apply');
    expect(
      decideVendorStatusTransition({
        from: 'PENDING_VERIFICATION',
        to: 'ACTIVE',
        onboardingStatus: 'DRAFT',
      }).kind,
    ).toBe('invalid');
  });

  it('requires a reason to reject and treats the same status as idempotent', () => {
    expect(
      decideVendorStatusTransition({
        from: 'PENDING_VERIFICATION',
        to: 'REJECTED',
        onboardingStatus: 'PENDING_REVIEW',
      }).kind,
    ).toBe('invalid');
    expect(
      decideVendorStatusTransition({
        from: 'ACTIVE',
        to: 'ACTIVE',
        onboardingStatus: 'PENDING_REVIEW',
      }).kind,
    ).toBe('idempotent');
  });

  it('blocks accepting work before the vendor is active', () => {
    expect(
      assertOperationalStatusAllowed('PENDING_VERIFICATION', 'ONLINE').kind,
    ).toBe('invalid');
    expect(assertOperationalStatusAllowed('ACTIVE', 'TEMPORARILY_UNAVAILABLE').kind).toBe(
      'apply',
    );
  });
});
