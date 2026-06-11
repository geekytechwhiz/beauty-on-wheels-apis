import { TemplateEntityBuilder } from '../builder/template-entity.builder';
import { TEMPLATE_STATUS } from '../constants/template.constants';
import type { EnablementDdbRecord } from '../models/api/enablement.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { OrgTemplateSyncService } from './org-template-sync.service';

function buildPublishedMaster(version: number): TemplateDdbRecord {
  const ctx = TemplateEntityBuilder.buildCreateContext({
    templateCode: 'TASK_MONITORING',
    templateName: 'Task Monitoring',
    status: TEMPLATE_STATUS.PUBLISHED,
  });
  const row = TemplateEntityBuilder.buildVersionRow(ctx, {
    templateCode: 'TASK_MONITORING',
    templateName: 'Task Monitoring',
  });
  row.meta.templateId = 'TASK-MONITORING-MASTER';
  row.meta.templateVersionId = 'TASK-MONITORING-MASTER-V01';
  row.meta.version = version;
  row.meta.status = TEMPLATE_STATUS.PUBLISHED;
  return row;
}

function buildEnablement(masterTemplateVersion: number): EnablementDdbRecord {
  return {
    pk: 'ENABLE#ENB-1',
    sk: 'META',
    entityType: 'ORG_ENABLEMENT',
    meta: {
      enablementId: 'ENB-1',
      organizationId: 'org-1',
      masterTemplateId: 'TASK-MONITORING-MASTER',
      masterTemplateVersionId: 'TASK-MONITORING-MASTER-V01',
      masterTemplateVersion,
      orgTemplateId: 'TASK-MONITORING-MASTER-ORG-ORG-1',
      templateEnabled: true,
      effectiveFrom: '2024-01-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  };
}

describe('OrgTemplateSyncService.syncAllEnabledOrgsFromMaster', () => {
  it('does not overwrite org templates or adopted master version on passive master update', async () => {
    const masterV13 = buildPublishedMaster(1.3);
    const enablement = buildEnablement(1.2);
    const syncContent = jest.fn();
    const putEnablementOverwrite = jest.fn();

    const svc = new OrgTemplateSyncService(
      { getOrgMeta: jest.fn() } as never,
      {
        queryEnablementsByMasterTemplateGsi5: jest.fn().mockResolvedValue([enablement]),
        queryEnablementsByMasterVersionGsi3: jest.fn().mockResolvedValue([]),
        findByOrgAndMasterTemplateId: jest.fn().mockResolvedValue(enablement),
        putEnablementOverwrite,
      } as never,
      {
        queryMasterVersionsPage: jest.fn().mockResolvedValue({ items: [masterV13] }),
      } as never,
    );
    svc.syncOrgTemplateContentFromMaster = syncContent;

    await svc.syncAllEnabledOrgsFromMaster(masterV13);

    expect(syncContent).not.toHaveBeenCalled();
    expect(putEnablementOverwrite).toHaveBeenCalledTimes(1);
    const savedMeta = putEnablementOverwrite.mock.calls[0][0].meta;
    expect(savedMeta.masterTemplateVersion).toBe(1.2);
    expect(savedMeta.masterTemplateVersionId).toBe('TASK-MONITORING-MASTER-V01');
    expect(savedMeta.templateName).toBe('Task Monitoring');
  });
});

describe('OrgTemplateSyncService.upsertEnablementForOrg', () => {
  it('bumps adopted master version on explicit adopt', async () => {
    const masterV13 = buildPublishedMaster(1.3);
    const existing = buildEnablement(1.2);
    const putEnablementOverwrite = jest.fn();

    const svc = new OrgTemplateSyncService(
      {} as never,
      {
        findByOrgAndMasterTemplateId: jest.fn().mockResolvedValue(existing),
        putEnablementOverwrite,
      } as never,
      {} as never,
    );

    await svc.upsertEnablementForOrg('org-1', masterV13, existing.meta.orgTemplateId!);

    const savedMeta = putEnablementOverwrite.mock.calls[0][0].meta;
    expect(savedMeta.masterTemplateVersion).toBe(1.3);
    expect(savedMeta.masterTemplateVersionId).toBe('TASK-MONITORING-MASTER-V01');
  });
});
