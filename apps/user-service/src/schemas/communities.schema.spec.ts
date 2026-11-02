import { CommunityCreateSchema } from './communities.schema';

const validCommunity = {
  name: 'Palm Grove Residency',
  accessType: 'GATED_COMMUNITY',
  city: 'Kochi',
  locality: 'Kakkanad',
  postalCode: '682030',
  contactPersonName: 'Anita Menon',
  contactPersonTitle: 'Secretary',
  contactPhone: '+919876543210',
  totalResidentialUnits: 120,
  estimatedVehicleCount: 156,
  leadSource: 'FIELD_SCOUTING',
};

describe('CommunityCreateSchema', () => {
  it('accepts all required setup fields and a vehicle count above unit count', () => {
    expect(CommunityCreateSchema.safeParse(validCommunity).success).toBe(true);
    expect(CommunityCreateSchema.safeParse({
      ...validCommunity,
      estimatedVehicleCount: 156,
      totalResidentialUnits: 120,
    }).success).toBe(true);
  });

  it('rejects missing required fields, invalid PINs, and negative counts', () => {
    expect(CommunityCreateSchema.safeParse({ ...validCommunity, accessType: undefined }).success).toBe(false);
    expect(CommunityCreateSchema.safeParse({ ...validCommunity, postalCode: '68203' }).success).toBe(false);
    expect(CommunityCreateSchema.safeParse({ ...validCommunity, totalResidentialUnits: 0 }).success).toBe(false);
    expect(CommunityCreateSchema.safeParse({ ...validCommunity, estimatedVehicleCount: -1 }).success).toBe(false);
  });
});
