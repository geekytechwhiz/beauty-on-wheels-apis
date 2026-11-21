import {
  commitmentQuantityForDate,
  commitmentsForDate,
} from './manager-shared';

const commitments = [
  {
    commitmentId: 'daily',
    communityId: 'community-1',
    quantity: 4,
    reservedSoldQuantity: 0,
    status: 'ACTIVE',
    window: {
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      dailyWindow: { startTime: '09:00', endTime: '18:00' },
    },
  },
  {
    commitmentId: 'monday-only',
    communityId: 'community-1',
    quantity: 2,
    reservedSoldQuantity: 0,
    status: 'CHANGE_PENDING',
    window: {
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      dailyWindow: { startTime: '09:00', endTime: '18:00' },
      daysOfWeek: ['MONDAY'],
    },
  },
  {
    commitmentId: 'cancelled',
    communityId: 'community-1',
    quantity: 20,
    reservedSoldQuantity: 0,
    status: 'CANCELLED',
    window: {
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      dailyWindow: { startTime: '09:00', endTime: '18:00' },
    },
  },
];

describe('commitment capacity projections', () => {
  it('counts only supply holding on the selected recurring weekday', () => {
    expect(commitmentQuantityForDate(commitments, '2026-11-16')).toBe(6);
    expect(commitmentQuantityForDate(commitments, '2026-11-17')).toBe(4);
  });

  it('preserves applicable commitment rows for the planning display', () => {
    expect(
      commitmentsForDate(commitments, '2026-11-16')?.map(
        (item) => item.commitmentId,
      ),
    ).toEqual(['daily', 'monday-only']);
  });
});
