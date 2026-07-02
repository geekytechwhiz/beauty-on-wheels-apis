import { TemplateKeyBuilder } from '../builder/template-key.builder';
import { TEMPLATE_STATUS } from '../constants/template.constants';
import type { EnablementDdbRecord } from '../models/api/enablement.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { OrgTemplateOpsService } from './org-template-ops.service';
import { OrgTemplateRulesService } from './org-template-rules.service';

function enabledOrgRows(): {
  enablement: EnablementDdbRecord;
  meta: TemplateDdbRecord;
  version: TemplateDdbRecord;
} {
  const enablement: EnablementDdbRecord = {
    pk: 'ENABLE#en-1',
    sk: 'META',
    entityType: 'ENABLEMENT',
    meta: {
      enablementId: 'en-1',
      organizationId: 'org-1',
      masterTemplateId: 'CARE-PLAN-7',
      masterTemplateVersionId: 'CARE-PLAN-7-V01',
      orgTemplateId: 'CARE-PLAN-7-ORG-ORG1',
      templateName: 'Care Plan 7',
    },
  };
  const meta: TemplateDdbRecord = {
    pk: TemplateKeyBuilder.toOrgPk('org-1', 'CARE-PLAN-7-ORG-ORG1'),
    sk: 'META',
    entityType: 'ORG_TEMPLATE',
    meta: {
      templateId: 'CARE-PLAN-7-ORG-ORG1',
      templateVersionId: 'CARE-PLAN-7-ORG-ORG1-V01',
      version: 1,
      status: TEMPLATE_STATUS.SAVED,
      ownerOrgId: 'org-1',
      isMaster: false,
      masterTemplateId: 'CARE-PLAN-7',
      derivedFromMasterVersion: 1,
      derivedFromTemplateVersionId: 'CARE-PLAN-7-V01',
      templateName: 'Care Plan 7',
      templateType: 'care plan 7',
      lastModifiedAt: '2026-01-01T00:00:00.000Z',
    },
  };
  const version: TemplateDdbRecord = {
    ...meta,
    sk: 'VERSION#001',
    meta: { ...meta.meta },
    fieldValues: {
      CATEGORY: 'CHRONIC_CARE',
      GOALS: [{ goalName: 'Reduce BP', goalType: 'CLINICAL' }],
    },
    rules: {
      CATEGORY: {
        enable: true,
        orgedit: true,
        add: true,
        defaultedit: true,
        delete: true,
      },
      goalName: {
        enable: true,
        orgedit: true,
        add: true,
        defaultedit: true,
        delete: true,
      },
    },
  };
  return { enablement, meta, version };
}

describe('OrgTemplateRulesService', () => {
  it('returns minimal org details and rules on get', async () => {
    const { enablement, meta, version } = enabledOrgRows();
    const orgRepo = {
      getOrgMeta: jest.fn().mockResolvedValue(meta),
      getOrgVersionForMeta: jest.fn().mockResolvedValue(version),
    };
    const enablementRepo = {
      findByOrgAndMasterTemplateId: jest.fn().mockResolvedValue(enablement),
    };
    const orgOps = new OrgTemplateOpsService(orgRepo as never);

    const svc = new OrgTemplateRulesService(orgRepo as never, enablementRepo as never, orgOps);
    const result = await svc.getOrgTemplateRules({
      masterTemplateId: 'CARE-PLAN-7',
      organizationId: 'org-1',
    });

    expect(result.organizationId).toBe('org-1');
    expect(result.masterTemplateId).toBe('CARE-PLAN-7');
    expect(result.orgTemplateId).toBe('CARE-PLAN-7-ORG-ORG1');
    expect(result.version).toBe(1);
    expect(result.fieldValues).toEqual({
      CATEGORY: 'CHRONIC_CARE',
      GOALS: [{ goalName: 'Reduce BP', goalType: 'CLINICAL' }],
    });
    expect(result.rules.CATEGORY).toEqual({
      enable: true,
      orgedit: true,
      add: true,
      defaultedit: true,
      delete: true,
      metadataMode: 'Fixed',
      min: 1,
      max: 1,
    });
    expect(result.rules.goalName.metadataMode).toBe('Fixed');
    expect(result.upgrade).toBe(false);
    expect(result.adopt).toBeNull();
  });

  it('merges rules and bumps minor version on put', async () => {
    const { enablement, meta, version } = enabledOrgRows();
    const orgRepo = {
      getOrgMeta: jest.fn().mockResolvedValue(meta),
      getOrgVersionForMeta: jest.fn().mockResolvedValue(version),
      saveOrgMetaAndVersion: jest.fn().mockResolvedValue(undefined),
    };
    const enablementRepo = {
      findByOrgAndMasterTemplateId: jest.fn().mockResolvedValue(enablement),
    };
    const orgOps = new OrgTemplateOpsService(orgRepo as never);

    const svc = new OrgTemplateRulesService(orgRepo as never, enablementRepo as never, orgOps);
    const result = await svc.updateOrgTemplateRules({
      masterTemplateId: 'CARE-PLAN-7',
      organizationId: 'org-1',
      rules: { CATEGORY: { enable: false, orgedit: false } },
      actorUser: { userId: 'user-1' },
    });

    expect(result.version).toBe(1.1);
    expect(result.rules.CATEGORY).toEqual({
      enable: false,
      orgedit: false,
      add: true,
      defaultedit: true,
      delete: true,
      metadataMode: 'Fixed',
      min: 1,
      max: 1,
    });
    expect(orgRepo.saveOrgMetaAndVersion).toHaveBeenCalled();
  });

  it('merges fieldValues, regenerates rules, and bumps version on put', async () => {
    const { enablement, meta, version } = enabledOrgRows();
    const orgRepo = {
      getOrgMeta: jest.fn().mockResolvedValue(meta),
      getOrgVersionForMeta: jest.fn().mockResolvedValue(version),
      saveOrgMetaAndVersion: jest.fn().mockResolvedValue(undefined),
    };
    const enablementRepo = {
      findByOrgAndMasterTemplateId: jest.fn().mockResolvedValue(enablement),
    };
    const orgOps = new OrgTemplateOpsService(orgRepo as never);

    const svc = new OrgTemplateRulesService(orgRepo as never, enablementRepo as never, orgOps);
    const result = await svc.updateOrgTemplateRules({
      masterTemplateId: 'CARE-PLAN-7',
      organizationId: 'org-1',
      fieldValues: { CATEGORY: 'ACUTE_CARE' },
      actorUser: { userId: 'user-1' },
    });

    expect(result.version).toBe(1.1);
    expect(result.fieldValues.CATEGORY).toBe('ACUTE_CARE');
    expect(result.fieldValues.GOALS).toEqual([{ goalName: 'Reduce BP', goalType: 'CLINICAL' }]);
    expect(result.rules.CATEGORY).toBeDefined();
    expect(orgRepo.saveOrgMetaAndVersion).toHaveBeenCalled();
  });

  it('merges rules, fieldValues, status, and active in one put', async () => {
    const { enablement, meta, version } = enabledOrgRows();
    const orgRepo = {
      getOrgMeta: jest.fn().mockResolvedValue(meta),
      getOrgVersionForMeta: jest.fn().mockResolvedValue(version),
      saveOrgMetaAndVersion: jest.fn().mockResolvedValue(undefined),
    };
    const enablementRepo = {
      findByOrgAndMasterTemplateId: jest.fn().mockResolvedValue(enablement),
    };
    const orgOps = new OrgTemplateOpsService(orgRepo as never);

    const svc = new OrgTemplateRulesService(orgRepo as never, enablementRepo as never, orgOps);
    const result = await svc.updateOrgTemplateRules({
      masterTemplateId: 'CARE-PLAN-7',
      organizationId: 'org-1',
      rules: { CATEGORY: { enable: false } },
      fieldValues: { CATEGORY: 'ACUTE_CARE' },
      status: TEMPLATE_STATUS.PUBLISHED,
      active: true,
      actorUser: { userId: 'user-1' },
    });

    expect(result.version).toBe(1.1);
    expect(result.status).toBe(TEMPLATE_STATUS.PUBLISHED);
    expect(result.active).toBe(true);
    expect(result.fieldValues.CATEGORY).toBe('ACUTE_CARE');
    expect(orgRepo.saveOrgMetaAndVersion).toHaveBeenCalledTimes(1);
  });

  it('updates status and active without bumping version when content is unchanged', async () => {
    const { enablement, meta, version } = enabledOrgRows();
    const orgRepo = {
      getOrgMeta: jest.fn().mockResolvedValue(meta),
      getOrgVersionForMeta: jest.fn().mockResolvedValue(version),
      saveOrgMetaAndVersion: jest.fn().mockImplementation(async (m: TemplateDdbRecord, v: TemplateDdbRecord) => {
        meta.meta = m.meta;
        version.meta = v.meta;
      }),
    };
    const enablementRepo = {
      findByOrgAndMasterTemplateId: jest.fn().mockResolvedValue(enablement),
    };
    const orgOps = new OrgTemplateOpsService(orgRepo as never);

    const svc = new OrgTemplateRulesService(orgRepo as never, enablementRepo as never, orgOps);
    const result = await svc.updateOrgTemplateRules({
      masterTemplateId: 'CARE-PLAN-7',
      organizationId: 'org-1',
      status: TEMPLATE_STATUS.PUBLISHED,
      active: false,
      actorUser: { userId: 'user-1' },
    });

    expect(result.version).toBe(1);
    expect(result.status).toBe(TEMPLATE_STATUS.PUBLISHED);
    expect(result.active).toBe(false);
    expect(orgRepo.saveOrgMetaAndVersion).toHaveBeenCalledTimes(1);
  });

  it('allows rules and fieldValues updates when canonical org template is already published', async () => {
    const { enablement, meta, version } = enabledOrgRows();
    meta.meta.status = TEMPLATE_STATUS.PUBLISHED;
    version.meta.status = TEMPLATE_STATUS.PUBLISHED;

    const orgRepo = {
      getOrgMeta: jest.fn().mockResolvedValue(meta),
      getOrgVersionForMeta: jest.fn().mockResolvedValue(version),
      saveOrgMetaAndVersion: jest.fn().mockResolvedValue(undefined),
    };
    const enablementRepo = {
      findByOrgAndMasterTemplateId: jest.fn().mockResolvedValue(enablement),
    };
    const orgOps = new OrgTemplateOpsService(orgRepo as never);

    const svc = new OrgTemplateRulesService(orgRepo as never, enablementRepo as never, orgOps);
    const result = await svc.updateOrgTemplateRules({
      masterTemplateId: 'CARE-PLAN-7',
      organizationId: 'org-1',
      rules: { CATEGORY: { enable: false } },
      fieldValues: { CATEGORY: 'ACUTE_CARE' },
      status: TEMPLATE_STATUS.PUBLISHED,
      active: true,
      actorUser: { userId: 'user-1' },
    });

    expect(result.status).toBe(TEMPLATE_STATUS.PUBLISHED);
    expect(result.version).toBe(1.1);
    expect(result.fieldValues.CATEGORY).toBe('ACUTE_CARE');
    expect(orgRepo.saveOrgMetaAndVersion).toHaveBeenCalledTimes(1);
  });

  it('adopts baseline when adopt is true on put', async () => {
    const { enablement, meta, version } = enabledOrgRows();
    version.meta.version = 1.6;
    version.meta.derivedFromMasterVersion = 1;
    meta.meta.version = 1.6;
    meta.meta.derivedFromMasterVersion = 1;
    version.versionHistory = [
      {
        version: 1.6,
        templateVersionId: 'CARE-PLAN-7-ORG-ORG1-V01',
        status: TEMPLATE_STATUS.PUBLISHED,
        action: 'PUBLISHED',
        fieldValues: version.fieldValues,
        rules: version.rules,
      },
      {
        version: 1,
        templateVersionId: 'CARE-PLAN-7-ORG-ORG1-V01',
        status: TEMPLATE_STATUS.SAVED,
        action: 'CREATED',
        fieldValues: version.fieldValues,
        rules: version.rules,
      },
    ];

    let savedVersion: TemplateDdbRecord | undefined;
    const orgRepo = {
      getOrgMeta: jest.fn().mockResolvedValue(meta),
      getOrgVersionForMeta: jest.fn().mockResolvedValue(version),
      saveOrgMetaAndVersion: jest.fn().mockImplementation(async (m: TemplateDdbRecord, v: TemplateDdbRecord) => {
        meta.meta = m.meta;
        version.meta = v.meta;
        version.versionHistory = v.versionHistory;
        savedVersion = v;
      }),
    };
    const enablementRepo = {
      findByOrgAndMasterTemplateId: jest.fn().mockResolvedValue(enablement),
    };
    const orgOps = new OrgTemplateOpsService(orgRepo as never);

    const svc = new OrgTemplateRulesService(orgRepo as never, enablementRepo as never, orgOps);
    const result = await svc.updateOrgTemplateRules({
      masterTemplateId: 'CARE-PLAN-7',
      organizationId: 'org-1',
      adopt: true,
      actorUser: { userId: 'user-1' },
    });

    expect(result.version).toBe(1.7);
    expect(result.upgrade).toBe(false);
    expect(result.adopt).toBeNull();
    expect(result.derivedFromMasterVersion).toBe(1.7);
    expect(orgRepo.saveOrgMetaAndVersion).toHaveBeenCalledTimes(1);
    expect(savedVersion?.versionHistory?.[0]?.action).toBe('ADOPTED');
    expect(savedVersion?.versionHistory?.[0]?.version).toBe(1.7);
  });
});
