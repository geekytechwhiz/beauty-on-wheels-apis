import { DERIVATION_KIND } from '../constants/template.constants';
import { OrgTemplateEntityBuilder } from '../builder/org-template-entity.builder';
import { OrgDerivedService } from './org-derived.service';

describe('OrgTemplateEntityBuilder org-derived', () => {
  it('buildDerivedOrgTemplateId slugifies name and appends short uuid', () => {
    const id = OrgTemplateEntityBuilder.buildDerivedOrgTemplateId('HTN Care Plan — Variant A');
    expect(id).toMatch(/^HTN-CARE-PLAN-VARIANT-A-[a-z0-9]{8}$/);
  });
});

describe('OrgDerivedService.createOrgDerived', () => {
  function buildService(overrides?: {
    sourceMeta?: Record<string, unknown>;
    existingVariants?: Array<{ templateName: string }>;
  }) {
    const orgRepo = {
      getOrgMeta: jest.fn().mockResolvedValue({
        meta: {
          templateId: 'TEST-TEMPLATE-ORG-ROSEWOOD',
          masterTemplateId: 'TEST-TEMPLATE',
          masterTemplateVersionId: 'TEST-TEMPLATE-V01',
          templateVersionId: 'TEST-TEMPLATE-ORG-ROSEWOOD-V01',
          ...overrides?.sourceMeta,
        },
      }),
      getOrgVersionForMeta: jest.fn().mockResolvedValue({
        meta: { templateVersionId: 'TEST-TEMPLATE-ORG-ROSEWOOD-V01' },
        fieldValues: { Category: { value: 'CHRONIC_DISEASE' } },
        rules: { Category: { enable: true } },
      }),
      getOrgVersion: jest.fn(),
      queryOrgTemplatesGsi1Page: jest.fn().mockResolvedValue({
        items: (overrides?.existingVariants ?? []).map((v) => ({
          sk: 'META',
          meta: {
            templateId: 'EXISTING-id',
            templateName: v.templateName,
            derivationKind: DERIVATION_KIND.ORG_DERIVE,
          },
        })),
      }),
      createOrgTemplate: jest.fn().mockResolvedValue(undefined),
    };
    const enablementRepo = {
      findByOrgAndOrgTemplateId: jest.fn().mockResolvedValue(null),
      putEnablement: jest.fn().mockResolvedValue(undefined),
    };
    const orgProfileRepo = {
      getOrgProfile: jest.fn(),
      putOrgProfile: jest.fn(),
    };
    const orgOps = {
      extractDocumentFields: jest.fn(),
      saveOrgTemplateInPlace: jest.fn(),
    };

    orgRepo.getOrgVersionForMeta.mockImplementation(async (_org: string, templateId: string) => ({
      meta: { templateVersionId: `${templateId}-V01` },
      fieldValues: {},
      rules: {},
    }));

    const svc = new OrgDerivedService(
      orgRepo as never,
      enablementRepo as never,
      orgProfileRepo as never,
      orgOps as never,
    );

    return { svc, orgRepo, enablementRepo };
  }

  it('allows org-derived variant as sourceOrgTemplateId', async () => {
    const { svc } = buildService({
      sourceMeta: {
        derivationKind: DERIVATION_KIND.ORG_DERIVE,
        derivedFromOrgTemplateId: 'TEST-TEMPLATE-ORG-ROSEWOOD',
        derivedFromOrgTemplateVersionId: 'TEST-TEMPLATE-ORG-ROSEWOOD-V01',
        derivedFromOrgTemplateVersion: 1,
      },
    });

    const result = await svc.createOrgDerived({
      organizationId: 'ROSEWOOD',
      sourceOrgTemplateId: 'HTN-VARIANT-A-abc12345',
      newTemplateName: 'HTN Care Plan — Variant B',
    });

    expect(result.orgTemplateId).toMatch(/^HTN-CARE-PLAN-VARIANT-B-/);
  });

  it('rejects duplicate newTemplateName among variants', async () => {
    const { svc } = buildService({
      existingVariants: [{ templateName: 'HTN Care Plan — Variant A' }],
    });

    await expect(
      svc.createOrgDerived({
        organizationId: 'ROSEWOOD',
        sourceOrgTemplateId: 'TEST-TEMPLATE-ORG-ROSEWOOD',
        newTemplateName: 'HTN Care Plan — Variant A',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('creates variant from canonical source', async () => {
    const { svc, orgRepo, enablementRepo } = buildService();

    const result = await svc.createOrgDerived({
      organizationId: 'ROSEWOOD',
      sourceOrgTemplateId: 'TEST-TEMPLATE-ORG-ROSEWOOD',
      newTemplateName: 'HTN Care Plan — Variant A',
      templateEnabled: true,
    });

    expect(orgRepo.createOrgTemplate).toHaveBeenCalled();
    expect(enablementRepo.putEnablement).toHaveBeenCalled();
    expect(result.sourceOrgTemplateId).toBe('TEST-TEMPLATE-ORG-ROSEWOOD');
    expect(result.orgTemplateId).toMatch(/^HTN-CARE-PLAN-VARIANT-A-/);
    expect(result.templateEnabled).toBe(true);
    expect(result.status).toBe('DRAFT');
    expect(result.active).toBe(true);
  });

  it('defaults templateEnabled to true when omitted', async () => {
    const { svc } = buildService();

    const result = await svc.createOrgDerived({
      organizationId: 'ROSEWOOD',
      sourceOrgTemplateId: 'TEST-TEMPLATE-ORG-ROSEWOOD',
      newTemplateName: 'HTN Care Plan — Variant B',
    });

    expect(result.templateEnabled).toBe(true);
  });
});

describe('OrgDerivedService.getOrgDerived list', () => {
  it('filters ORG_CARE_PLAN to care-plan variants only', async () => {
    const carePlanVariant = {
      sk: 'META',
      meta: {
        templateId: 'CP-VAR-1',
        templateName: 'HTN Variant',
        templateType: 'CARE_PLAN',
        derivationKind: DERIVATION_KIND.ORG_DERIVE,
        derivedFromOrgTemplateId: 'CANONICAL-CP-1',
        templateVersionId: 'CP-VAR-1-V01',
        version: 1,
      },
    };
    const monitoringVariant = {
      sk: 'META',
      meta: {
        templateId: 'MON-VAR-1',
        templateName: 'BP Monitoring Variant',
        templateType: 'MONITORING',
        derivationKind: DERIVATION_KIND.ORG_DERIVE,
        derivedFromOrgTemplateId: 'CANONICAL-MON-1',
        templateVersionId: 'MON-VAR-1-V01',
        version: 1,
      },
    };

    const orgRepo = {
      queryOrgTemplatesGsi1Page: jest.fn().mockResolvedValue({
        items: [carePlanVariant, monitoringVariant],
      }),
      getOrgVersionForMeta: jest.fn().mockImplementation(async (_org: string, templateId: string) => ({
        meta: { templateId, templateVersionId: `${templateId}-V01`, version: 1 },
        fieldValues: {
          Category: { value: 'CHRONIC_DISEASE' },
          Condition: { value: 'HYPERTENSION' },
        },
        rules: {},
      })),
      listOrgVersions: jest.fn().mockResolvedValue({ items: [] }),
      getOrgMeta: jest.fn(),
    };
    const enablementRepo = {
      findByOrgAndOrgTemplateId: jest.fn().mockResolvedValue({ meta: { effectiveTo: null } }),
    };
    const orgProfileRepo = {
      getOrgProfile: jest.fn().mockResolvedValue({ meta: { organizationId: 'org-1', name: 'org-1' } }),
    };

    const svc = new OrgDerivedService(
      orgRepo as never,
      enablementRepo as never,
      orgProfileRepo as never,
      {} as never,
    );

    const result = await svc.getOrgDerived({
      organizationId: 'org-1',
      carePlanOnly: true,
    });

    expect(result).toMatchObject({
      items: [{ orgTemplateId: 'CP-VAR-1' }],
      pagination: { total: 1, count: 1 },
    });
    expect(result.items[0].history).toHaveLength(1);
    expect(result.items[0].history[0].title).toBe('Template Created');
  });
});
