import {
  compareTemplateDisplayVersions,
  formatTemplateVersionLabel,
  resolveTemplateDisplayVersion,
} from './template.utils';

describe('resolveTemplateDisplayVersion', () => {
  it('prefers meta.version over templateVersionId major segment', () => {
    expect(
      resolveTemplateDisplayVersion({
        templateVersionId: 'TASK-MONITORING-MASTER-V01',
        version: 1.2,
      }),
    ).toBe(1.2);
  });

  it('falls back to V suffix when version missing', () => {
    expect(
      resolveTemplateDisplayVersion({
        templateVersionId: 'TASK-MONITORING-MASTER-V02',
      }),
    ).toBe(2);
  });

  it('formats decimal labels', () => {
    expect(formatTemplateVersionLabel(1.2)).toBe('v1.2');
  });

  it('compares decimal versions for upgrade', () => {
    expect(compareTemplateDisplayVersions(1.2, 1)).toBeGreaterThan(0);
    expect(compareTemplateDisplayVersions(1.2, 1.2)).toBe(0);
  });
});
