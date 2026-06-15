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

describe('OrgTemplateSyncService.syncOrgTemplateContentFromMaster', () => {
  it('resolves VERSION#001 when meta.version is a minor display after rules edit', async () => {
    const masterVersion = buildPublishedMaster(1);
    const orgMeta: TemplateDdbRecord = {
      pk: 'ORG#org-1#TMPL#TASK-MONITORING-MASTER-ORG-ORG-1',
      sk: 'META',
      entityType: 'ORG_TEMPLATE',
      meta: {
        templateId: 'TASK-MONITORING-MASTER-ORG-ORG-1',
        templateVersionId: 'TASK-MONITORING-MASTER-ORG-ORG-1-V01',
        version: 1.2,
        status: TEMPLATE_STATUS.DRAFT,
        templateName: 'Task Monitoring',
      },
    };
    const orgVersion: TemplateDdbRecord = {
      pk: orgMeta.pk,
      sk: 'VERSION#001',
      entityType: 'ORG_TEMPLATE_VERSION',
      meta: orgMeta.meta,
      fieldValues: { a: 1 },
    };
    const getOrgMeta = jest.fn().mockResolvedValue(orgMeta);
    const getOrgVersionForMeta = jest.fn().mockResolvedValue(orgVersion);
    const saveOrgMetaAndVersion = jest.fn().mockResolvedValue(undefined);

    const svc = new OrgTemplateSyncService(
      {
        getOrgMeta,
        getOrgVersionForMeta,
        saveOrgMetaAndVersion,
      } as never,
      {} as never,
      {} as never,
    );

    await svc.syncOrgTemplateContentFromMaster(
      'org-1',
      'TASK-MONITORING-MASTER-ORG-ORG-1',
      'TASK-MONITORING-MASTER',
      masterVersion,
    );

    expect(getOrgVersionForMeta).toHaveBeenCalledWith(
      'org-1',
      'TASK-MONITORING-MASTER-ORG-ORG-1',
      orgMeta.meta,
    );
    expect(saveOrgMetaAndVersion).toHaveBeenCalled();
  });

  it('bootstraps VERSION#001 from master when org META exists but VERSION row is missing', async () => {
    const masterVersion = buildPublishedMaster(1);
    const orgTemplateId = 'TASK-MONITORING-MASTER-ORG-ORG-1';
    const orgMeta: TemplateDdbRecord = {
      pk: 'ORG#org-1#TMPL#TASK-MONITORING-MASTER-ORG-ORG-1',
      sk: 'META',
      entityType: 'ORG_TEMPLATE',
      meta: {
        templateId: orgTemplateId,
        templateVersionId: 'TASK-MONITORING-MASTER-V01',
        version: 1.1,
        status: TEMPLATE_STATUS.DRAFT,
        templateName: 'Task Monitoring',
        masterTemplateId: 'TASK-MONITORING-MASTER',
      },
    };
    const saveOrgMetaAndVersion = jest.fn().mockResolvedValue(undefined);

    const svc = new OrgTemplateSyncService(
      {
        getOrgMeta: jest.fn().mockResolvedValue(orgMeta),
        getOrgVersionForMeta: jest.fn().mockResolvedValue(null),
        saveOrgMetaAndVersion,
      } as never,
      {} as never,
      {} as never,
    );

    await svc.syncOrgTemplateContentFromMaster(
      'org-1',
      orgTemplateId,
      'TASK-MONITORING-MASTER',
      masterVersion,
    );

    expect(saveOrgMetaAndVersion).toHaveBeenCalled();
    const versionRow = saveOrgMetaAndVersion.mock.calls[0][1] as TemplateDdbRecord;
    expect(versionRow.sk).toBe('VERSION#001');
    expect(versionRow.meta.templateVersionId).toBe(`${orgTemplateId}-V01`);
    expect(versionRow.rules).toBeDefined();
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
