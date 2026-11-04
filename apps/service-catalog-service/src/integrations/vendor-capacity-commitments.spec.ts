import { parseCapacityCommitmentFacts } from './vendor-capacity-commitments';

describe('parseCapacityCommitmentFacts', () => {
  it('accepts the Vendor internal lookup envelope', () => {
    const facts = parseCapacityCommitmentFacts(
      {
        data: {
          commitments: [
            {
              commitmentId: 'cmt-1',
              vendorId: 'vendor-1',
              communityId: 'community-1',
              status: 'ACTIVE',
              quantity: 12,
              holdsCapacity: true,
              scope: { offeringId: 'pkg_1', label: 'Exterior wash' },
            },
          ],
        },
      },
      ['cmt-1'],
    );
    expect(facts).toEqual([
      {
        commitmentId: 'cmt-1',
        vendorId: 'vendor-1',
        communityId: 'community-1',
        status: 'ACTIVE',
        quantity: 12,
        holdsCapacity: true,
        scope: { offeringId: 'pkg_1', label: 'Exterior wash' },
      },
    ]);
  });

  it('fails closed when Vendor omits a requested commitment rather than inventing one', () => {
    expect(() =>
      parseCapacityCommitmentFacts(
        {
          data: {
            commitments: [
              {
                commitmentId: 'other',
                vendorId: 'vendor-1',
                communityId: 'community-1',
                status: 'ACTIVE',
                quantity: 1,
                holdsCapacity: true,
                scope: { label: 'Exterior wash' },
              },
            ],
          },
        },
        ['cmt-1'],
      ),
    ).toThrow(/invalid capacity commitment id/);
  });
});
