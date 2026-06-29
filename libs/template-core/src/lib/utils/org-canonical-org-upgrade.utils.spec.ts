import {
  buildCanonicalOrgSelfAdoptPreview,
  resolveCanonicalOrgBaselineVersion,
  resolveCanonicalOrgSelfUpgrade,
  resolveCanonicalOrgUpgradeContext,
} from './org-canonical-org-upgrade.utils';

describe('org-canonical-org-upgrade.utils', () => {
  const metaRow = {
    meta: {
      templateId: 'ANOTHER-ONE-ORG-ORG1',
      templateVersionId: 'ANOTHER-ONE-ORG-ORG1-V01',
      templateName: 'ANOTHER ONE',
      derivedFromMasterVersion: 1.1,
      version: 1.6,
    },
  };

  const versionRow = {
    meta: {
      templateId: 'ANOTHER-ONE-ORG-ORG1',
      templateVersionId: 'ANOTHER-ONE-ORG-ORG1-V01',
      templateName: 'ANOTHER ONE',
      derivedFromMasterVersion: 1.1,
      version: 1.6,
      status: 'PUBLISHED',
    },
    fieldValues: { TASK: 'updated' },
    rules: { TASK: { enable: true } },
    versionHistory: [
      {
        version: 1.6,
        templateVersionId: 'ANOTHER-ONE-ORG-ORG1-V01',
        status: 'PUBLISHED',
        action: 'PUBLISHED',
        fieldValues: { TASK: 'updated' },
        rules: { TASK: { enable: true } },
      },
      {
        version: 1.1,
        templateVersionId: 'ANOTHER-ONE-ORG-ORG1-V01',
        status: 'PUBLISHED',
        action: 'CREATED',
        fieldValues: { TASK: 'original' },
        rules: { TASK: { enable: true } },
      },
    ],
  };

  it('detects upgrade when org version is ahead of baseline', () => {
    expect(resolveCanonicalOrgBaselineVersion(versionRow.meta as never)).toBe(1.1);
    expect(resolveCanonicalOrgSelfUpgrade(metaRow as never, versionRow as never)).toBe(true);
  });

  it('builds adopt preview from baseline to current org version', () => {
    const preview = buildCanonicalOrgSelfAdoptPreview({
      metaRow: metaRow as never,
      versionRow: versionRow as never,
    });

    expect(preview?.available).toBe(true);
    expect(preview?.fromVersion).toBe(1.1);
    expect(preview?.toVersion).toBe(1.6);
  });

  it('returns no upgrade when baseline matches current version', () => {
    const aligned = {
      ...versionRow,
      meta: { ...versionRow.meta, version: 1.1, derivedFromMasterVersion: 1.1 },
    };
    const ctx = resolveCanonicalOrgUpgradeContext(metaRow as never, aligned as never);
    expect(ctx.upgrade).toBe(false);
    expect(ctx.adopt).toBeNull();
  });
});
