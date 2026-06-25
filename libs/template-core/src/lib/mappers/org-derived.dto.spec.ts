import { TEMPLATE_STATUS } from '../constants/template.constants';
import { resolveOrgDerivedItemHistory, toOrgDerivedDetail, toOrgDerivedListItem } from './org-derived.dto';

describe('toOrgDerivedListItem upgrade', () => {
  const baseVariant = {
    metaRow: {
      meta: {
        templateId: 'HTN-VARIANT-A-abc12345',
        templateVersionId: 'HTN-VARIANT-A-abc12345-V01',
        templateName: 'HTN Care Plan — Variant A',
        version: 1,
        derivationKind: 'orgDerive',
        derivedFromOrgTemplateId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849',
        derivedFromOrgTemplateVersionId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849-V01',
        derivedFromOrgTemplateVersion: 1,
        status: TEMPLATE_STATUS.DRAFT,
        isActive: true,
      },
    },
    versionRow: {
      meta: {
        templateId: 'HTN-VARIANT-A-abc12345',
        templateVersionId: 'HTN-VARIANT-A-abc12345-V01',
        status: TEMPLATE_STATUS.DRAFT,
        isActive: true,
      },
      fieldValues: {},
      rules: {},
    },
  };

  it('returns false when canonical org version matches derived snapshot', () => {
    const item = toOrgDerivedListItem(
      baseVariant.metaRow as never,
      baseVariant.versionRow as never,
      null,
      {
        templateId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849',
        templateVersionId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849-V01',
        version: 1,
      },
    );

    expect(item.upgrade).toBe(false);
    expect(item.status).toBe(TEMPLATE_STATUS.DRAFT);
    expect(item.active).toBe(true);
  });

  it('returns true when canonical org template was updated after variant copy', () => {
    const item = toOrgDerivedListItem(
      baseVariant.metaRow as never,
      baseVariant.versionRow as never,
      null,
      {
        templateId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849',
        templateVersionId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849-V01',
        version: 1.1,
      },
    );

    expect(item.upgrade).toBe(true);
  });

  it('includes history on list items when versionHistory is stored', () => {
    const versionRow = {
      ...baseVariant.versionRow,
      versionHistory: [
        {
          version: 1,
          templateVersionId: 'HTN-CARE-PLAN-VARIANT-A-abc12345-V01',
          status: TEMPLATE_STATUS.DRAFT,
          action: 'CREATED',
          title: 'Template Created',
          isActive: true,
          isLatestVersion: true,
          changes: [],
        },
      ],
    };
    const history = resolveOrgDerivedItemHistory(versionRow as never);

    const item = toOrgDerivedListItem(
      baseVariant.metaRow as never,
      versionRow as never,
      null,
      {
        templateId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849',
        templateVersionId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849-V01',
        version: 1,
      },
      history,
    );

    expect(item.history).toHaveLength(1);
    expect(item.history?.[0].title).toBe('Template Created');
  });

  it('returns adopt preview on single get when upgrade is available', () => {
    const detail = toOrgDerivedDetail(
      'mqf0agcd0aa65849',
      baseVariant.metaRow as never,
      baseVariant.versionRow as never,
      null,
      {
        templateId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849',
        templateVersionId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849-V02',
        version: 2,
      },
      {
        canonicalFromRow: {
          meta: {
            templateId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849',
            templateVersionId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849-V01',
            version: 1,
          },
          fieldValues: { Category: { value: 'CHRONIC_DISEASE' } },
        } as never,
        canonicalToRow: {
          meta: {
            templateId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849',
            templateVersionId: 'ROSEWOOD-ORG-MQF0AGCD0AA65849-V02',
            version: 2,
          },
          fieldValues: {
            Category: { value: 'CHRONIC_DISEASE' },
            EducationHub: { value: 'ENABLED' },
          },
        } as never,
      },
    );

    expect(detail.upgrade).toBe(true);
    expect(detail.adopt?.available).toBe(true);
    expect(detail.adopt?.toVersionLabel).toBe('v2');
    expect(detail.adopt?.changes.added.length).toBeGreaterThan(0);
  });
});
