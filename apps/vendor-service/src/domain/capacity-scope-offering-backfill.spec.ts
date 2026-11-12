import {
  classifyCapacityScope,
  planCapacityScopeRepair,
  type CapacityScopeSnapshot,
} from './capacity-scope-offering-backfill';

function snapshot(
  overrides: Partial<CapacityScopeSnapshot> = {},
): CapacityScopeSnapshot {
  return {
    kind: 'CapacityCommitment',
    recordId: 'cmt_1',
    vendorId: 'vendor-1',
    communityId: 'com-1',
    scope: { serviceScopeCode: 'service:CAR_WASH', label: 'Car wash' },
    pk: 'VENDOR#vendor-1',
    sk: 'CAPACITY_COMMITMENT#cmt_1',
    ...overrides,
  };
}

describe('capacity-scope-offering-backfill', () => {
  it('classifies legacy rows missing offeringId', () => {
    expect(classifyCapacityScope(snapshot())).toEqual({
      missingOfferingId: true,
      hasLegacyServiceScopeCode: true,
    });
  });

  it('does not invent an offeringId without a verified mapping', () => {
    const plan = planCapacityScopeRepair(snapshot(), []);
    expect(plan.action).toBe('needsManualMapping');
    expect(plan.nextScope).toBeUndefined();
  });

  it('applies a verified serviceScopeCode mapping while keeping the legacy code readable', () => {
    const plan = planCapacityScopeRepair(snapshot(), [
      {
        serviceScopeCode: 'service:CAR_WASH',
        offeringId: 'pkg_car_wash',
        verified: true,
      },
    ]);
    expect(plan).toMatchObject({
      action: 'setOfferingId',
      nextScope: {
        offeringId: 'pkg_car_wash',
        label: 'Car wash',
        serviceScopeCode: 'service:CAR_WASH',
      },
    });
  });

  it('prefers per-record mapping over serviceScopeCode mapping', () => {
    const plan = planCapacityScopeRepair(snapshot(), [
      {
        serviceScopeCode: 'service:CAR_WASH',
        offeringId: 'pkg_from_code',
        verified: true,
      },
      {
        recordId: 'cmt_1',
        offeringId: 'pkg_from_record',
        verified: true,
      },
    ]);
    expect(plan.nextScope?.offeringId).toBe('pkg_from_record');
  });

  it('no-ops when offeringId is already present', () => {
    const plan = planCapacityScopeRepair(
      snapshot({ scope: { offeringId: 'pkg_car_wash', label: 'Car wash' } }),
      [{ offeringId: 'pkg_other', verified: true, recordId: 'cmt_1' }],
    );
    expect(plan.action).toBe('noop');
  });
});
