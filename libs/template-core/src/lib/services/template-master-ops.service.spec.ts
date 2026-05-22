import { TemplateEntityBuilder } from '../builder/template-entity.builder';
import { TEMPLATE_STATUS } from '../constants/template.constants';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { TemplateMasterOpsService } from './template-master-ops.service';

function draftMasterRows(): { meta: TemplateDdbRecord; version: TemplateDdbRecord } {
  const ctx = TemplateEntityBuilder.buildCreateContext({
    templateCode: 'CP_HTN_STANDARD',
    templateName: 'Hypertension Plan',
    status: 'DRAFT',
  });
  return {
    meta: TemplateEntityBuilder.buildMetaRow(ctx),
    version: TemplateEntityBuilder.buildVersionRow(ctx, {
      templateCode: 'CP_HTN_STANDARD',
      templateName: 'Hypertension Plan',
    }),
  };
}

describe('TemplateMasterOpsService.transitionMasterTemplateStatus', () => {
  it('SUBMIT_REVIEW persists IN_REVIEW on META and VERSION rows', async () => {
    const { meta, version } = draftMasterRows();
    let savedMeta: TemplateDdbRecord | undefined;
    let savedVersion: TemplateDdbRecord | undefined;

    const repo = {
      getMasterMeta: jest.fn().mockResolvedValue(meta),
      getMasterVersion: jest.fn().mockResolvedValue(version),
      saveMasterMetaAndVersion: jest.fn().mockImplementation(async (m: TemplateDdbRecord, v: TemplateDdbRecord) => {
        savedMeta = m;
        savedVersion = v;
      }),
    };

    const svc = new TemplateMasterOpsService(repo as never);
    const result = await svc.transitionMasterTemplateStatus({
      templateId: 'CP-HTN-STANDARD',
      versionId: 'V01',
      body: { action: 'SUBMIT_REVIEW', comment: 'Ready' },
      actorUserId: 'admin-1',
    });

    expect(result.meta.status).toBe(TEMPLATE_STATUS.IN_REVIEW);
    expect(savedMeta?.meta.status).toBe(TEMPLATE_STATUS.IN_REVIEW);
    expect(savedVersion?.meta.status).toBe(TEMPLATE_STATUS.IN_REVIEW);
    expect(savedMeta?.meta.templateVersionId).toBe('CP-HTN-STANDARD-V01');
    expect(savedMeta?.gsi5pk).toBe('SCOPE#MASTER#STATUS#IN_REVIEW');
    expect(savedVersion?.sk).toBe('VERSION#001');
  });

  it('rejects status transition when path version is not the META pointer', async () => {
    const { meta, version } = draftMasterRows();
    meta.meta.version = 2;
    meta.meta.templateVersionId = 'CP-HTN-STANDARD-V02';

    const repo = {
      getMasterMeta: jest.fn().mockResolvedValue(meta),
      getMasterVersion: jest.fn().mockResolvedValue(version),
      saveMasterMetaAndVersion: jest.fn(),
    };

    const svc = new TemplateMasterOpsService(repo as never);

    await expect(
      svc.transitionMasterTemplateStatus({
        templateId: 'CP-HTN-STANDARD',
        versionId: 'V01',
        body: { action: 'SUBMIT_REVIEW' },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
