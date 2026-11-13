import { CrewDdbItem, StaffDdbItem } from '../types/repository.types';
import { toSchedulingCrew } from './scheduling-crew';

function crew(overrides: Partial<CrewDdbItem> = {}): CrewDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'CREW#crew-1',
    crewId: 'crew-1',
    vendorId: 'vendor-1',
    name: 'Crew Alpha',
    vanLabel: 'Van 01',
    staffIds: ['staff-1', 'staff-2'],
    status: 'ACTIVE',
    revision: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    entityType: 'Crew',
    ...overrides,
  };
}

function staff(staffId: string, status: 'ACTIVE' | 'INACTIVE'): StaffDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: `STAFF#${staffId}`,
    staffId,
    vendorId: 'vendor-1',
    name: staffId,
    phoneNumber: '+919800000000',
    status,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    entityType: 'Staff',
  };
}

describe('scheduling crew view', () => {
  it('returns current staff status and omits contact details', () => {
    const view = toSchedulingCrew(crew(), new Map([
      ['staff-1', staff('staff-1', 'ACTIVE')],
      ['staff-2', staff('staff-2', 'INACTIVE')],
    ]));
    expect(view.staff).toEqual([
      { staffId: 'staff-1', status: 'ACTIVE', name: 'staff-1' },
      { staffId: 'staff-2', status: 'INACTIVE', name: 'staff-2' },
    ]);
    expect(view.capacityPerDay).toBe(4);
    expect(view).toMatchObject({ availabilityStatus: 'UNAVAILABLE', availabilityReason: 'INSUFFICIENT_ACTIVE_STAFF' });
    expect(JSON.stringify(view)).not.toMatch(/phone|email/i);
  });

  it('does not treat a missing staff record as active', () => {
    const view = toSchedulingCrew(crew({ staffIds: ['missing'] }), new Map());
    expect(view.staff).toEqual([{ staffId: 'missing', status: 'INACTIVE' }]);
    expect(view).toMatchObject({ availabilityStatus: 'UNAVAILABLE', availabilityReason: 'INSUFFICIENT_ACTIVE_STAFF' });
  });

  it('tolerates a legacy crew row without a staff list', () => {
    const view = toSchedulingCrew(crew({ staffIds: undefined as unknown as string[] }), new Map(), { includePointOfContact: true });
    expect(view.staff).toEqual([]);
    expect(view).not.toHaveProperty('pointOfContact');
  });

  describe('point of contact', () => {
    const roster = new Map([
      ['staff-1', staff('staff-1', 'ACTIVE')],
      ['staff-2', { ...staff('staff-2', 'ACTIVE'), phoneNumber: '+919811111111' }],
      ['staff-3', staff('staff-3', 'INACTIVE')],
    ]);
    const withContact = (overrides: Partial<CrewDdbItem>) =>
      toSchedulingCrew(crew({ staffIds: ['staff-3', 'staff-1', 'staff-2'], ...overrides }), roster, { includePointOfContact: true });

    it('returns the explicitly designated active member with phone', () => {
      expect(withContact({ pointOfContactStaffId: 'staff-2' }).pointOfContact).toEqual({
        staffId: 'staff-2', name: 'staff-2', phoneNumber: '+919811111111', source: 'designated',
      });
    });

    it('falls back to the first active member in roster order when none is designated', () => {
      expect(withContact({}).pointOfContact).toEqual({
        staffId: 'staff-1', name: 'staff-1', phoneNumber: '+919800000000', source: 'firstActiveMember',
      });
    });

    it('falls back when the designated member is inactive or no longer on the crew', () => {
      expect(withContact({ pointOfContactStaffId: 'staff-3' }).pointOfContact).toMatchObject({ staffId: 'staff-1', source: 'firstActiveMember' });
      expect(withContact({ pointOfContactStaffId: 'staff-9' }).pointOfContact).toMatchObject({ staffId: 'staff-1', source: 'firstActiveMember' });
    });

    it('omits the contact when no crew member is active', () => {
      expect(withContact({ staffIds: ['staff-3', 'missing'] })).not.toHaveProperty('pointOfContact');
    });

    it('omits the phone number when the staff record has none', () => {
      const noPhone = new Map([['staff-1', { ...staff('staff-1', 'ACTIVE'), phoneNumber: '' }]]);
      expect(toSchedulingCrew(crew({ staffIds: ['staff-1'] }), noPhone, { includePointOfContact: true }).pointOfContact)
        .toEqual({ staffId: 'staff-1', name: 'staff-1', source: 'firstActiveMember' });
    });

    it('is not returned unless requested, keeping the Booking roster free of contact data', () => {
      expect(toSchedulingCrew(crew({ staffIds: ['staff-1', 'staff-2'] }), roster)).not.toHaveProperty('pointOfContact');
    });
  });
});
