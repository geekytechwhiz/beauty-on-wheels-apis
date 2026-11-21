import { assertOfferingCommunity } from './create-booking';

describe('assertOfferingCommunity', () => {
  it('requires an approved active mapping only when enforcement is on', () => {
    expect(() => assertOfferingCommunity({
      enforced: false,
      fulfilmentType: 'community',
      communityId: 'community-1',
      communities: [],
    })).not.toThrow();

    expect(() => assertOfferingCommunity({
      enforced: true,
      fulfilmentType: 'community',
      communityId: 'community-1',
      communities: [{ communityId: 'community-1', status: 'inactive', approvalStatus: 'approved' }],
    })).toThrow(expect.objectContaining({ code: 'OFFERING_COMMUNITY_INACTIVE' }));

    expect(() => assertOfferingCommunity({
      enforced: true,
      fulfilmentType: 'community',
      communityId: 'community-1',
      communities: [{ communityId: 'community-1', status: 'active', approvalStatus: 'pending' }],
    })).toThrow(expect.objectContaining({ code: 'OFFERING_COMMUNITY_NOT_APPROVED' }));

    expect(() => assertOfferingCommunity({
      enforced: true,
      fulfilmentType: 'community',
      communityId: 'community-1',
      communities: [{ communityId: 'community-1', status: 'active', approvalStatus: 'rejected' }],
    })).toThrow(expect.objectContaining({ code: 'OFFERING_COMMUNITY_NOT_APPROVED' }));

    expect(() => assertOfferingCommunity({
      enforced: true,
      fulfilmentType: 'community',
      communityId: 'community-1',
      communities: [{ communityId: 'community-1', status: 'active' }],
    })).toThrow(expect.objectContaining({ code: 'OFFERING_COMMUNITY_NOT_APPROVED' }));

    expect(() => assertOfferingCommunity({
      enforced: true,
      fulfilmentType: 'community',
      communityId: 'community-1',
      communities: [{ communityId: 'community-1', status: 'active', approvalStatus: 'approved' }],
    })).not.toThrow();
  });

  it('leaves doorstep bookings on the existing pricing and availability checks', () => {
    expect(() => assertOfferingCommunity({
      enforced: true,
      fulfilmentType: 'doorstep',
      communities: [],
    })).not.toThrow();
  });
});

 