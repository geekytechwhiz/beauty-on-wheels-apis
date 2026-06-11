import {
  compareTemplateDisplayVersions,
  formatTemplateVersionLabel,
  resolveOrgVersionPointerSk,
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

describe('resolveOrgVersionPointerSk', () => {
  it('uses templateVersionId major segment when meta.version is a minor display', () => {
    expect(
      resolveOrgVersionPointerSk({
        templateVersionId: 'HYPERTENSION-MANAGEMENT-GOAL-PLAN-WITH-RULES-ORG-MLEPBAJ40DAC678B-V01',
        version: 1.2,
      }),
    ).toBe('VERSION#001');
  });

  it('falls back to VERSION#001 when only minor version is set', () => {
    expect(resolveOrgVersionPointerSk({ version: 1.1 })).toBe('VERSION#001');
  });

  it('uses integer major version when templateVersionId has no -V suffix', () => {
    expect(
      resolveOrgVersionPointerSk({
        templateVersionId: 'LEGACY-TEMPLATE-ID',
        version: 2,
      }),
    ).toBe('VERSION#002');
  });
});
