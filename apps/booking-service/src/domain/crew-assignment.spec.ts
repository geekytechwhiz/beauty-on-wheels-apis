import {
  assignmentConflicts,
  consensusInterval,
  parseAssignmentCommand,
  travelWarningsFor,
  windowInterval,
  workloadFor,
} from './crew-assignment';

const night = windowInterval({ visitWindowId: 'night', label: 'Night', startTime: '18:00', endTime: '21:00' }, 'night');
const morning = windowInterval({ visitWindowId: 'morning', label: 'Morning', startTime: '06:00', endTime: '09:00' }, 'morning');
const unknown = windowInterval({ visitWindowId: 'night', label: 'Night' }, 'night');

function slot(overrides: Partial<{
  date: string;
  communityId: string;
  visitWindowId: string;
  crewId: string;
  staffIds: string[];
  interval: ReturnType<typeof windowInterval>;
}> = {}) {
  return {
    date: '2026-10-30',
    communityId: 'community-1',
    visitWindowId: 'night',
    crewId: 'crew-1',
    staffIds: ['staff-1', 'staff-2'],
    interval: night,
    ...overrides,
  };
}

describe('crew assignment rules', () => {
  it('requires a bounded visit list and does not trust extra fields as staff', () => {
    expect(parseAssignmentCommand({
      scheduledDate: '2026-10-30',
      communityId: 'community-1',
      visitWindowId: 'night',
      crewId: 'crew-1',
      visitIds: ['visit-1', 'visit-2'],
    })).toMatchObject({ mode: 'assign', replaceExisting: false });
    expect(() => parseAssignmentCommand({
      scheduledDate: '2026-10-30',
      communityId: 'community-1',
      visitWindowId: 'night',
      crewId: 'crew-1',
      visitIds: ['visit-1', 'visit-1'],
    })).toThrow(/unique/);
  });

  it('uses the plan window and treats a missing snapshot as unknown', () => {
    expect(night).toMatchObject({ known: true, startMinute: 18 * 60, endMinute: 21 * 60 });
    expect(unknown.known).toBe(false);
    expect(consensusInterval([night, morning]).known).toBe(false);
  });

  it('rejects overlapping crews and shared active staff', () => {
    const crew = assignmentConflicts({
      target: slot(),
      others: [slot({ communityId: 'community-2' })],
    });
    expect(crew.map((item) => item.code)).toContain('CREW_WINDOW_OVERLAP');

    const staff = assignmentConflicts({
      target: slot({ crewId: 'crew-2', staffIds: ['staff-2', 'staff-3'] }),
      others: [slot()],
    });
    expect(staff).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'STAFF_WINDOW_OVERLAP', staffId: 'staff-2' }),
    ]));
  });

  it('allows the same crew to take more visits in the same window', () => {
    expect(assignmentConflicts({
      target: slot(),
      others: [slot()],
    })).toEqual([]);
  });

  it('does not treat separated windows as a crew conflict', () => {
    expect(assignmentConflicts({
      target: slot({ visitWindowId: 'morning', interval: morning, communityId: 'community-2' }),
      others: [slot()],
    })).toEqual([]);
  });

  it('fails closed when window times are missing', () => {
    const conflicts = assignmentConflicts({
      target: slot({ interval: unknown, communityId: 'community-2' }),
      others: [slot()],
    });
    expect(conflicts.map((item) => item.code)).toContain('WINDOW_TIMES_UNKNOWN');
  });

  it('sums known durations and refuses to invent a missing one', () => {
    const known = workloadFor([20, 20], night);
    expect(known).toMatchObject({
      durationKnown: true,
      estimatedMinutes: 40,
      availableMinutes: 180,
      utilizationPercent: 22,
      overloaded: false,
    });
    const heavy = workloadFor([100, 100], night);
    expect(heavy.overloaded).toBe(true);
    const missing = workloadFor([20, undefined], night);
    expect(missing.durationKnown).toBe(false);
    expect(missing.estimatedMinutes).toBeUndefined();
    expect(missing.overloaded).toBeUndefined();
    expect(missing.unknownDurationCount).toBe(1);
  });

  it('warns on a short community gap and does not invent a gap without times', () => {
    const verified = travelWarningsFor([
      slot({ interval: { known: true, allDay: false, startMinute: 18 * 60, endMinute: 21 * 60 } }),
      slot({
        communityId: 'community-2',
        visitWindowId: 'late',
        interval: { known: true, allDay: false, startMinute: 21 * 60 + 10, endMinute: 22 * 60 },
      }),
    ], 30);
    expect(verified).toEqual([
      expect.objectContaining({ verified: true, gapMinutes: 10, requiredMinutes: 30 }),
    ]);

    const unverified = travelWarningsFor([
      slot({ interval: unknown }),
      slot({ communityId: 'community-2', visitWindowId: 'morning', interval: morning }),
    ], 30);
    expect(unverified[0]).toMatchObject({ verified: false });
    expect(unverified[0].gapMinutes).toBeUndefined();
    expect(unverified[0].message).toMatch(/cannot be verified/);
  });

  it('does not warn when the crew stays in one community', () => {
    expect(travelWarningsFor([
      slot(),
      slot({ visitWindowId: 'late', interval: { known: true, allDay: false, startMinute: 21 * 60, endMinute: 22 * 60 } }),
    ], 30)).toEqual([]);
  });
});
