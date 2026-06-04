import { TemplateEntityBuilder } from '../builder/template-entity.builder';
import { TEMPLATE_STATUS } from '../constants/template.constants';
import { EnablementService } from './enablement.service';

describe('EnablementService.createOrgEnablement', () => {
  it('creates enablement when master version is PUBLISHED and none exists', async () => {
    const ctx = TemplateEntityBuilder.buildCreateContext({
      templateCode: 'CP_HTN_STANDARD',
      templateName: 'Hypertension Plan',
      status: TEMPLATE_STATUS.PUBLISHED,
    });
    const masterVersion = TemplateEntityBuilder.buildVersionRow(ctx, {
      templateCode: 'CP_HTN_STANDARD',
      templateName: 'Hypertension Plan',
    });
    masterVersion.meta.status = TEMPLATE_STATUS.PUBLISHED;
    masterVersion.meta.templateVersionId = 'CP-HTN-001-V01';

    const templateRepo = {
      getMasterVersion: jest.fn().mockResolvedValue(masterVersion),
    };
    const enablementRepo = {
      findByOrgAndMasterTemplateId: jest.fn().mockResolvedValue(null),
      putEnablement: jest.fn().mockResolvedValue(undefined),
    };

    const svc = new EnablementService(enablementRepo as never, templateRepo as never);
    const dto = await svc.createOrgEnablement({
      body: {
        organizationId: 'org-1',
        masterTemplateVersionId: 'CP-HTN-001-V01',
        effectiveFrom: '2024-04-01T00:00:00Z',
      },
      actorUserId: 'admin-1',
    });

    expect(dto.organizationId).toBe('org-1');
    expect(dto.masterTemplateVersionId).toBe('CP-HTN-001-V01');
    expect(enablementRepo.putEnablement).toHaveBeenCalledTimes(1);
  });

  it('rejects when master version is not PUBLISHED', async () => {
    const ctx = TemplateEntityBuilder.buildCreateContext({
      templateCode: 'CP_HTN_STANDARD',
      templateName: 'Hypertension Plan',
      status: TEMPLATE_STATUS.DRAFT,
    });
    const masterVersion = TemplateEntityBuilder.buildVersionRow(ctx, {
      templateCode: 'CP_HTN_STANDARD',
      templateName: 'Hypertension Plan',
    });
    masterVersion.meta.templateVersionId = 'CP-HTN-001-V01';

    const templateRepo = {
      getMasterVersion: jest.fn().mockResolvedValue(masterVersion),
    };
    const enablementRepo = {
      findByOrgAndMasterTemplateId: jest.fn(),
      putEnablement: jest.fn(),
    };

    const svc = new EnablementService(enablementRepo as never, templateRepo as never);

    await expect(
      svc.createOrgEnablement({
        body: {
          organizationId: 'org-1',
          masterTemplateVersionId: 'CP-HTN-001-V01',
        },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('EnablementService.searchOrgEnablements', () => {
  it('returns items from GSI1 when filtering by organization', async () => {
    const row = {
      pk: 'ENABLE#ENB-1',
      sk: 'META',
      entityType: 'ORG_ENABLEMENT' as const,
      meta: {
        enablementId: 'ENB-1',
        organizationId: 'org-1',
        masterTemplateId: 'CP-HTN-001',
        masterTemplateVersionId: 'CP-HTN-001-V01',
        orgTemplateId: 'CP-HTN-001-ORG-ORG1',
        effectiveFrom: '2024-04-01T00:00:00Z',
        createdAt: '2024-04-01T00:00:00Z',
      },
    };

    const enablementRepo = {
      queryEnablementsByOrgGsi1: jest.fn().mockResolvedValue([row]),
      queryEnablementsByMasterVersionGsi3: jest.fn(),
    };
    const templateRepo = {};

    const svc = new EnablementService(enablementRepo as never, templateRepo as never);
    const result = await svc.searchOrgEnablements({ organizationId: 'org-1' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].enablementId).toBe('ENB-1');
  });
});

describe('EnablementService.updateOrgEnablement', () => {
  it('deletes row and returns null on REVOKE', async () => {
    const record = {
      pk: 'ENABLE#ENB-1',
      sk: 'META',
      entityType: 'ORG_ENABLEMENT' as const,
      meta: {
        enablementId: 'ENB-1',
        organizationId: 'org-1',
        masterTemplateVersionId: 'CP-HTN-001-V01',
        effectiveFrom: '2024-04-01T00:00:00Z',
        createdAt: '2024-04-01T00:00:00Z',
      },
      gsi1pk: 'ORG#org-1',
      gsi1sk: 'ENABLE#2024-04-01T00:00:00Z#ENB-1',
      gsi3pk: 'MSTR_VER#CP-HTN-001-V01',
      gsi3sk: 'ORG#org-1#ENB-1',
    };

    const enablementRepo = {
      getEnablement: jest.fn().mockResolvedValue(record),
      deleteEnablement: jest.fn().mockResolvedValue(undefined),
      putEnablementOverwrite: jest.fn(),
    };
    const templateRepo = {};

    const svc = new EnablementService(enablementRepo as never, templateRepo as never);
    const result = await svc.updateOrgEnablement({
      enablementId: 'ENB-1',
      body: { action: 'REVOKE' },
    });

    expect(result).toBeNull();
    expect(enablementRepo.deleteEnablement).toHaveBeenCalledWith('ENB-1');
  });

  it('updates effective dates on UPDATE', async () => {
    const record = {
      pk: 'ENABLE#ENB-1',
      sk: 'META',
      entityType: 'ORG_ENABLEMENT' as const,
      meta: {
        enablementId: 'ENB-1',
        organizationId: 'org-1',
        masterTemplateVersionId: 'CP-HTN-001-V01',
        effectiveFrom: '2024-04-01T00:00:00Z',
        effectiveTo: null,
        createdAt: '2024-04-01T00:00:00Z',
      },
      gsi1pk: 'ORG#org-1',
      gsi1sk: 'ENABLE#2024-04-01T00:00:00Z#ENB-1',
      gsi3pk: 'MSTR_VER#CP-HTN-001-V01',
      gsi3sk: 'ORG#org-1#ENB-1',
    };

    const enablementRepo = {
      getEnablement: jest.fn().mockResolvedValue(record),
      putEnablementOverwrite: jest.fn().mockResolvedValue(undefined),
      deleteEnablement: jest.fn(),
    };
    const templateRepo = {};

    const svc = new EnablementService(enablementRepo as never, templateRepo as never);
    const result = await svc.updateOrgEnablement({
      enablementId: 'ENB-1',
      body: {
        action: 'UPDATE',
        effectiveTo: '2025-12-31T23:59:59Z',
      },
    });

    expect(result?.effectiveTo).toBe('2025-12-31T23:59:59Z');
    expect(enablementRepo.putEnablementOverwrite).toHaveBeenCalled();
  });
});
