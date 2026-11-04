import { CAPACITY_COMMITMENT_STATUS } from '../domain/capacity-commitment';
import { CapacityCommitmentLookupService } from './capacity-commitment-lookup.service';

describe('CapacityCommitmentLookupService', () => {
  const repository = {
    getCommitmentById: jest.fn(),
  };

  const service = new CapacityCommitmentLookupService(repository as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns holding facts and omits unknown ids', async () => {
    repository.getCommitmentById.mockImplementation(async (id: string) => {
      if (id !== 'cmt-1') return null;
      return {
        commitmentId: 'cmt-1',
        vendorId: 'vendor-1',
        communityId: 'community-1',
        status: CAPACITY_COMMITMENT_STATUS.ACTIVE,
        quantity: 20,
        scope: { label: 'Exterior wash' },
        window: {
          startDate: '2026-11-01',
          endDate: '2026-11-30',
          dailyWindow: { startTime: '06:30', endTime: '09:30' },
        },
      };
    });

    await expect(service.lookup(['cmt-1', 'missing'])).resolves.toEqual([
      expect.objectContaining({
        commitmentId: 'cmt-1',
        vendorId: 'vendor-1',
        communityId: 'community-1',
        holdsCapacity: true,
      }),
    ]);
  });

  it('marks cancelled commitments as not holding capacity', async () => {
    repository.getCommitmentById.mockResolvedValue({
      commitmentId: 'cmt-2',
      vendorId: 'vendor-1',
      communityId: 'community-1',
      status: CAPACITY_COMMITMENT_STATUS.CANCELLED,
      quantity: 5,
      scope: { label: 'Exterior wash' },
      window: {
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        dailyWindow: { startTime: '06:30', endTime: '09:30' },
      },
    });

    await expect(service.lookup(['cmt-2'])).resolves.toEqual([
      expect.objectContaining({
        commitmentId: 'cmt-2',
        holdsCapacity: false,
        status: CAPACITY_COMMITMENT_STATUS.CANCELLED,
      }),
    ]);
  });
});
