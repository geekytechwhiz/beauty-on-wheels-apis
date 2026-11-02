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
    expect(JSON.stringify(view)).not.toMatch(/phone|email/i);
  });

  it('does not treat a missing staff record as active', () => {
    const view = toSchedulingCrew(crew({ staffIds: ['missing'] }), new Map());
    expect(view.staff).toEqual([{ staffId: 'missing', status: 'INACTIVE' }]);
  });
});
