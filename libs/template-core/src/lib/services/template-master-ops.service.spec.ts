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

describe('TemplateMasterOpsService.updateMasterTemplateVersion', () => {
  it('updates version-only master in place with shareScope and fieldValues', async () => {
    const ctx = TemplateEntityBuilder.buildCreateContext({
      templateCode: 'task-code',
      templateName: 'Task Monitoring Master',
      templateType: 'TASK',
      status: 'DRAFT',
    });
    const version = TemplateEntityBuilder.buildVersionRow(ctx, {
      templateCode: 'task-code',
      templateName: 'Task Monitoring Master',
      shareScope: 'PRIVATE',
      fieldValues: { TASK_NAME: 'Record Blood Pressure' },
    });

    let saved: TemplateDdbRecord | undefined;
    const repo = {
      getMasterMeta: jest.fn().mockResolvedValue(version),
      getMasterVersion: jest.fn().mockResolvedValue(version),
      putMasterRecord: jest.fn().mockImplementation(async (row: TemplateDdbRecord) => {
        saved = row;
      }),
      saveMasterMetaAndVersion: jest.fn(),
    };

    const svc = new TemplateMasterOpsService(repo as never);
    const result = await svc.updateMasterTemplateVersion({
      templateId: 'TASK-CODE',
      versionId: 'TASK-CODE-V01',
      body: {
        shareScope: 'Organization',
        fieldValues: {
          TASK_NAME: 'Record Blood Pressure (updated)',
          TASK_DESCRIPTION: 'Measure BP twice daily',
        },
      },
      actorUserId: 'admin-1',
    });

    expect(result.meta.templateVersionId).toBe('TASK-CODE-V01');
    expect(result.meta.version).toBe(1);
    expect(result.meta.shareScope).toBe('ORGANIZATION');
    expect(result.meta.templateName).toBe('Record Blood Pressure (updated)');
    expect((result.fieldValues as Record<string, unknown>).TASK_DESCRIPTION).toBe(
      'Measure BP twice daily',
    );
    expect(result.meta.lastModifiedAt).not.toBe(version.meta.createdAt);
    expect(saved?.meta.shareScope).toBe('ORGANIZATION');
  });

  it('sets isActive false via active field on update', async () => {
    const ctx = TemplateEntityBuilder.buildCreateContext({
      templateCode: 'task-code',
      templateName: 'Task Monitoring Master',
      templateType: 'TASK',
      status: 'PUBLISHED',
    });
    const version = TemplateEntityBuilder.buildVersionRow(ctx, {
      templateCode: 'task-code',
      templateName: 'Task Monitoring Master',
      active: true,
    });

    let saved: TemplateDdbRecord | undefined;
    const repo = {
      getMasterMeta: jest.fn().mockResolvedValue(version),
      getMasterVersion: jest.fn().mockResolvedValue(version),
      putMasterRecord: jest.fn().mockImplementation(async (row: TemplateDdbRecord) => {
        saved = row;
      }),
      saveMasterMetaAndVersion: jest.fn(),
    };

    const svc = new TemplateMasterOpsService(repo as never);
    await svc.updateMasterTemplateVersion({
      templateId: 'TASK-CODE',
      versionId: 'TASK-CODE-V01',
      body: { active: false },
      actorUserId: 'admin-1',
    });

    expect(saved?.meta.isActive).toBe(false);
    expect(saved?.meta.status).toBe('PUBLISHED');
  });
});
