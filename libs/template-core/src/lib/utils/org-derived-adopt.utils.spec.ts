import {
  buildOrgDerivedAdoptPreview,
  detectVariantLocalChanges,
  mergeVariantAdoptDocument,
  resolveCanonicalSnapshotRow,
} from './org-derived-adopt.utils';

describe('org-derived-adopt.utils', () => {
  const canonicalFromRow = {
    meta: { templateId: 'ORG-1', templateVersionId: 'ORG-1-V01', version: 1 },
    fieldValues: {
      Category: { value: 'CHRONIC_DISEASE' },
      ReviewCadence: { value: '30D' },
    },
    rules: { Category: { enable: true } },
  };

  const canonicalToRow = {
    meta: { templateId: 'ORG-1', templateVersionId: 'ORG-1-V02', version: 2 },
    fieldValues: {
      Category: { value: 'CHRONIC_DISEASE' },
      ReviewCadence: { value: '15D' },
      EducationHub: { value: 'ENABLED' },
    },
    rules: { Category: { enable: true } },
  };

  const variantRow = {
    meta: { templateId: 'VAR-1', templateVersionId: 'VAR-1-V01', version: 1, templateName: 'HTN Care Plan' },
    fieldValues: {
      Category: { value: 'CHRONIC_DISEASE' },
      ReviewCadence: { value: '15D' },
    },
    rules: { Category: { enable: true, orgedit: false } },
  };

  it('detects local changes when variant differs from canonical snapshot', () => {
    expect(detectVariantLocalChanges(variantRow as never, canonicalFromRow as never)).toBe(true);
  });

  it('builds adopt preview with added/changed/removed sections', () => {
    const preview = buildOrgDerivedAdoptPreview({
      variantMeta: {
        templateId: 'VAR-1',
        templateVersionId: 'VAR-1-V01',
        templateName: 'HTN Care Plan',
        derivedFromOrgTemplateId: 'ORG-1',
        derivedFromOrgTemplateVersionId: 'ORG-1-V01',
        derivedFromOrgTemplateVersion: 1,
      },
      variantVersionRow: variantRow as never,
      canonicalFromRow: canonicalFromRow as never,
      canonicalToRow: canonicalToRow as never,
      sourceOrgTemplateId: 'ORG-1',
    });

    expect(preview?.available).toBe(true);
    expect(preview?.title).toBe("What's new in HTN Care Plan v1 → v2");
    expect(preview?.fromVersionLabel).toBe('v1');
    expect(preview?.toVersionLabel).toBe('v2');
    expect(preview?.changes.added.some((row) => row.key === 'EducationHub')).toBe(true);
    expect(
      preview?.changes.changed.some(
        (row) => row.key === 'ReviewCadence' && row.preserved && row.message.includes('30D'),
      ),
    ).toBe(true);
    for (const row of [
      ...preview!.changes.added,
      ...preview!.changes.changed,
      ...preview!.changes.removed,
    ]) {
      expect(row.message).not.toMatch(/^\{"/);
      expect(row.message.length).toBeLessThan(300);
    }
  });

  it('merges canonical latest while preserving variant overrides', () => {
    const merged = mergeVariantAdoptDocument(
      variantRow as never,
      canonicalToRow as never,
      canonicalFromRow as never,
    );

    const fv = merged.fieldValues as Record<string, unknown>;
    expect((fv.ReviewCadence as { value: string }).value).toBe('15D');
    expect((fv.EducationHub as { value: string }).value).toBe('ENABLED');
  });

  it('resolves in-place canonical snapshot from versionHistory when version id is unchanged', () => {
    const latestRow = {
      meta: {
        templateId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849',
        templateVersionId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849-V01',
        version: 5.7,
      },
      fieldValues: {
        Category: { value: 'CHRONIC_DISEASE' },
      },
      rules: { Category: { enable: true, orgedit: false } },
      versionHistory: [
        {
          version: 5.7,
          templateVersionId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849-V01',
          status: 'DRAFT',
          action: 'UPDATED',
          title: 'Template Updated',
          isActive: true,
          isLatestVersion: true,
          changes: ['rules.Category.orgedit: true → false'],
          fieldValues: {
            Category: { value: 'CHRONIC_DISEASE' },
          },
          rules: { Category: { enable: true, orgedit: false } },
        },
        {
          version: 5.6,
          templateVersionId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849-V01',
          status: 'DRAFT',
          action: 'UPDATED',
          title: 'Template Updated',
          isActive: true,
          isLatestVersion: false,
          changes: [],
          fieldValues: {
            Category: { value: 'CHRONIC_DISEASE' },
          },
          rules: { Category: { enable: true, orgedit: true } },
        },
      ],
    };

    const snapshot = resolveCanonicalSnapshotRow({
      latestRow: latestRow as never,
      snapshotVersion: 5.6,
      snapshotVersionId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849-V01',
      rowAtVersionId: latestRow as never,
      variantVersionRow: variantRow as never,
    });

    expect(snapshot?.meta.version).toBe(5.6);
    expect((snapshot?.rules as Record<string, { orgedit: boolean }>).Category.orgedit).toBe(true);

    const preview = buildOrgDerivedAdoptPreview({
      variantMeta: {
        templateId: 'VAR-1',
        templateVersionId: 'VAR-1-V01',
        templateName: 'HTN Care Plan',
        derivedFromOrgTemplateId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849',
        derivedFromOrgTemplateVersionId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849-V01',
        derivedFromOrgTemplateVersion: 5.6,
      },
      variantVersionRow: variantRow as never,
      canonicalFromRow: snapshot as never,
      canonicalToRow: latestRow as never,
      sourceOrgTemplateId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849',
    });

    expect(preview?.available).toBe(true);
    expect(preview?.fromVersion).toBe(5.6);
    expect(preview?.toVersion).toBe(5.7);
    expect(preview?.changes.changed.some((row) => row.key === 'rules.Category')).toBe(true);
    expect(preview?.changes.changed.find((row) => row.key === 'rules.Category')?.message).toContain(
      'Category',
    );
    expect(preview?.changes.changed.find((row) => row.key === 'rules.Category')?.message).toContain(
      'org edit',
    );
    expect(preview?.changes.changed[0]?.message).not.toContain('{');
  });

  it('lists each changed rule by name without JSON payloads', () => {
    const preview = buildOrgDerivedAdoptPreview({
      variantMeta: {
        templateId: 'ORG-1',
        templateVersionId: 'ORG-1-V01',
        templateName: 'ANOTHER ONE',
      },
      variantVersionRow: {
        meta: { templateId: 'ORG-1', templateVersionId: 'ORG-1-V01', version: 1.9 },
        fieldValues: { Category: { value: 'CHRONIC_DISEASE' } },
        rules: {
          Category: { enable: true },
          LinkedTaskTemplate: { enable: true, orgedit: true },
        },
      } as never,
      canonicalFromRow: {
        meta: { templateId: 'ORG-1', templateVersionId: 'ORG-1-V01', version: 1.8 },
        fieldValues: { Category: { value: 'CHRONIC_DISEASE' } },
        rules: {
          Category: { enable: true },
          LinkedTaskTemplate: { enable: true, orgedit: false },
        },
      } as never,
      canonicalToRow: {
        meta: { templateId: 'ORG-1', templateVersionId: 'ORG-1-V01', version: 1.9 },
        fieldValues: { Category: { value: 'CHRONIC_DISEASE' } },
        rules: {
          Category: { enable: true },
          LinkedTaskTemplate: { enable: true, orgedit: true, defaultedit: true },
        },
      } as never,
      sourceOrgTemplateId: 'ORG-1',
    });

    const linkedRule = preview?.changes.changed.find((row) => row.key === 'rules.LinkedTaskTemplate');
    expect(linkedRule?.label).toBe('Linked Task Templates');
    expect(linkedRule?.message).toContain('Linked Task Templates');
    expect(linkedRule?.message).toContain('org edit');
    expect(linkedRule?.message).not.toContain('{');
  });
});
