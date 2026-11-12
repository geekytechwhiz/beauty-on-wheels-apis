import { VendorsMapper } from './vendors.mapper';
import { VendorDdbItem } from '../types/repository.types';

function profile(): VendorDdbItem {
  return {
    PK: 'VENDOR#vendor-1', SK: 'PROFILE', vendorId: 'vendor-1', createdBy: 'staff-1',
    status: 'PENDING_VERIFICATION', operationalStatus: 'OFFLINE', onboardingStatus: 'DRAFT',
    currentSection: 'BUSINESS_INFO', completedSections: [], createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', GSI1PK: 'missing', GSI1SK: 'missing', entityType: 'Vendor',
  };
}

describe('VendorsMapper discovery keys', () => {
  it('regenerates keys for onboarding, lifecycle, and operational replacements', () => {
    const onboarding = VendorsMapper.applyOnboardingState(profile(), {
      onboardingStatus: 'IN_PROGRESS', currentSection: 'COMMUNITY_COVERAGE', completedSections: ['BUSINESS_INFO'],
    });
    const lifecycle = VendorsMapper.applyLifecycleTransition(onboarding, {
      status: 'ACTIVE', reviewerUserId: 'admin-1', reviewedAt: '2026-01-02T00:00:00.000Z',
    });
    const operational = VendorsMapper.applyOperationalStatusUpdate(lifecycle, 'ONLINE');

    expect(onboarding.GSI1SK).toContain('STATUS#PENDING_VERIFICATION#OPERATIONAL#OFFLINE#');
    expect(lifecycle.GSI1SK).toContain('STATUS#ACTIVE#OPERATIONAL#OFFLINE#');
    expect(operational.GSI1SK).toBe(
      'STATUS#ACTIVE#OPERATIONAL#ONLINE#2026-01-01T00:00:00.000Z#vendor-1',
    );
    expect(operational.GSI1PK).toBe('VENDOR');
  });
});
