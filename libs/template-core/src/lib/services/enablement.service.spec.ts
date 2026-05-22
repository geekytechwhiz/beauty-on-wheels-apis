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
      findByOrgAndMasterVersion: jest.fn().mockResolvedValue(null),
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
      findByOrgAndMasterVersion: jest.fn(),
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
