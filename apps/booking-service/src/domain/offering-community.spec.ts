import { assertLocation, assertOfferingCommunity } from './create-booking';
import { CreateBookingCommand } from '../schemas/bookings.schema';

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

describe('assertLocation', () => {
  it('does not require vendor community coverage for a community booking', () => {
    const command = {
      location: { fulfilmentType: 'community', communityId: 'community-1' },
    } as CreateBookingCommand;
    expect(() => assertLocation(
      command,
      { vendorId: 'vendor-1', status: 'ACTIVE', operationalStatus: 'ONLINE', communityIds: [] },
      { communityIds: ['community-1'] },
    )).not.toThrow();
    expect(() => assertLocation(
      command,
      { vendorId: 'vendor-1', status: 'ACTIVE', operationalStatus: 'ONLINE', communityIds: ['community-1'] },
      { communityIds: [] },
    )).toThrow(expect.objectContaining({ code: 'COMMUNITY_NOT_ASSIGNED' }));
  });
});
