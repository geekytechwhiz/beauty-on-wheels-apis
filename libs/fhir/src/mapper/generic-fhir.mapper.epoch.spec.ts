import { normalizeEpochMsToIso } from './generic-fhir.mapper';

describe('normalizeEpochMsToIso', () => {
  it('converts epoch millisecond strings to ISO-8601', () => {
    expect(normalizeEpochMsToIso('1780662540000')).toBe(
      new Date(1780662540000).toISOString(),
    );
  });

  it('passes through existing ISO timestamps', () => {
    const iso = '2026-06-05T10:00:00.000Z';
    expect(normalizeEpochMsToIso(iso)).toBe(iso);
  });
});
