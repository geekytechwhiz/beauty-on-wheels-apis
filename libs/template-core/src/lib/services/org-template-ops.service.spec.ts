import { TemplateKeyBuilder } from '../builder/template-key.builder';
import { TEMPLATE_STATUS } from '../constants/template.constants';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { OrgTemplateOpsService } from './org-template-ops.service';

function orgDraftRows(): { meta: TemplateDdbRecord; version: TemplateDdbRecord } {
  const meta: TemplateDdbRecord = {
    pk: TemplateKeyBuilder.toOrgPk('org-1', 'CP-ORG-001'),
    sk: 'META',
    entityType: 'ORG_TEMPLATE',
    meta: {
      templateId: 'CP-ORG-001',
      templateVersionId: 'CP-ORG-001-V01',
      version: 1,
      status: TEMPLATE_STATUS.DRAFT,
      ownerOrgId: 'org-1',
      isMaster: false,
      createdAt: '2024-01-01T00:00:00Z',
      lastModifiedAt: '2024-01-01T00:00:00Z',
    },
  };
  const version: TemplateDdbRecord = {
    ...meta,
    sk: 'VERSION#001',
    meta: { ...meta.meta },
  };
  return { meta, version };
}

describe('OrgTemplateOpsService.updateOrgTemplateVersion', () => {
  it('bumps minor version in place on fieldValues update', async () => {
    const { meta, version } = orgDraftRows();
    version.fieldValues = { CATEGORY: 'CHRONIC_CARE' };
    let savedMeta: TemplateDdbRecord | undefined;
    let savedVersion: TemplateDdbRecord | undefined;

    const orgRepo = {
      getOrgMeta: jest.fn().mockResolvedValue(meta),
      getOrgVersion: jest.fn().mockResolvedValue(version),
      saveOrgMetaAndVersion: jest.fn().mockImplementation(
        async (m: TemplateDdbRecord, v: TemplateDdbRecord) => {
          savedMeta = m;
          savedVersion = v;
        },
      ),
    };

    const svc = new OrgTemplateOpsService(orgRepo as never);
    const result = await svc.updateOrgTemplateVersion({
      organizationId: 'org-1',
      templateId: 'CP-ORG-001',
      versionId: 'V01',
      body: {
        fieldValues: {
          CATEGORY: 'CHRONIC_CARE',
          CONDITION: 'DIABETES',
        },
      },
      actorUser: { userId: 'user-1' },
    });

    expect(result.meta.version).toBe(1.1);
    expect(result.meta.templateVersionId).toBe('CP-ORG-001-V01');
    expect(savedMeta?.meta.version).toBe(1.1);
    expect(savedVersion?.sk).toBe('VERSION#001');
    expect(result.rules).toEqual(
      expect.objectContaining({
        CATEGORY: expect.objectContaining({ enable: true }),
        CONDITION: expect.objectContaining({ enable: true }),
      }),
    );
    expect(orgRepo.saveOrgMetaAndVersion).toHaveBeenCalledWith(expect.anything(), expect.anything());
  });

  it('does not bump version on meta-only update', async () => {
    const { meta, version } = orgDraftRows();
    let savedVersion: TemplateDdbRecord | undefined;

    const orgRepo = {
      getOrgMeta: jest.fn().mockResolvedValue(meta),
      getOrgVersion: jest.fn().mockResolvedValue(version),
      saveOrgMetaAndVersion: jest.fn().mockImplementation(
        async (_m: TemplateDdbRecord, v: TemplateDdbRecord) => {
          savedVersion = v;
        },
      ),
    };

    const svc = new OrgTemplateOpsService(orgRepo as never);
    const result = await svc.updateOrgTemplateVersion({
      organizationId: 'org-1',
      templateId: 'CP-ORG-001',
      versionId: 'V01',
      body: { meta: { templateName: 'Updated Org Plan' } },
      actorUser: { userId: 'user-1' },
    });

    expect(result.meta.version).toBe(1);
    expect(result.meta.templateName).toBe('Updated Org Plan');
    expect(savedVersion?.sk).toBe('VERSION#001');
  });

  it('rejects update when org template is PUBLISHED', async () => {
    const { meta, version } = orgDraftRows();
    meta.meta.status = TEMPLATE_STATUS.PUBLISHED;
    version.meta.status = TEMPLATE_STATUS.PUBLISHED;

    const orgRepo = {
      getOrgMeta: jest.fn().mockResolvedValue(meta),
      getOrgVersion: jest.fn().mockResolvedValue(version),
      saveOrgMetaAndVersion: jest.fn(),
    };

    const svc = new OrgTemplateOpsService(orgRepo as never);

    await expect(
      svc.updateOrgTemplateVersion({
        organizationId: 'org-1',
        templateId: 'CP-ORG-001',
        versionId: 'V01',
        body: { meta: { templateName: 'X' } },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
