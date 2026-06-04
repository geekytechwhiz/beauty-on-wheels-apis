import { TemplateEntityBuilder } from '../builder/template-entity.builder';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { TemplateRepository } from '../repositories/template.repository';
import { TemplateService } from './template.service';

describe('TemplateEntityBuilder', () => {
  it('create path uses VERSION row only (no META row)', () => {
    const ctx = TemplateEntityBuilder.buildCreateContext({
      templateCode: 'TASK_BP_MONITORING',
      templateName: 'Record Blood Pressure',
      templateType: 'TASK',
      status: 'DRAFT',
    });
    const version = TemplateEntityBuilder.buildVersionRow(ctx, {
      templateCode: 'TASK_BP_MONITORING',
      templateType: 'TASK',
      fieldValues: { TASK_NAME: 'Record Blood Pressure' },
    });

    expect(version.sk).toBe('VERSION#001');
    expect(version.pk).toBe('MASTER_TMPL#TASK-BP-MONITORING');
    expect(version.meta.templateType).toBe('TASK');
    expect(version.fieldValues).toEqual(
      expect.objectContaining({ TASK_NAME: 'Record Blood Pressure' }),
    );
  });

  it('builds meta and version rows with gsi keys for draft', () => {
    const ctx = TemplateEntityBuilder.buildCreateContext({
      templateCode: 'CP_HTN_STANDARD',
      templateName: 'Hypertension Plan',
      status: 'DRAFT',
    });

    const meta = TemplateEntityBuilder.buildMetaRow(ctx);
    const version = TemplateEntityBuilder.buildVersionRow(ctx, {
      templateCode: 'CP_HTN_STANDARD',
      templateName: 'Hypertension Plan',
    });

    expect(meta.pk).toBe('MASTER_TMPL#CP-HTN-STANDARD');
    expect(meta.sk).toBe('META');
    expect(version.sk).toBe('VERSION#001');
    expect(meta.gsi5pk).toBe('SCOPE#MASTER#STATUS#DRAFT');
    expect(meta.gsi2pk).toBeUndefined();
    expect(meta.gsi4pk).toBe('CODE#CP_HTN_STANDARD');
  });

  it('normalizes templateType to uppercase', () => {
    const ctx = TemplateEntityBuilder.buildCreateContext({
      templateCode: 'TASK_BP',
      templateName: 'BP Task',
      templateType: 'task',
    });
    expect(ctx.input.templateType).toBe('task');
    const meta = TemplateEntityBuilder.buildMeta(ctx);
    expect(meta.templateType).toBe('TASK');
  });

  it('maps OpenAPI specialties to meta.specialty', () => {
    const ctx = TemplateEntityBuilder.buildCreateContext({
      templateCode: 'CP_HTN_STANDARD',
      templateName: 'Plan',
      specialties: ['CARDIOLOGY', 'INTERNAL_MEDICINE'],
    });
    const meta = TemplateEntityBuilder.buildMeta(ctx);
    expect(meta.specialty).toEqual(['CARDIOLOGY', 'INTERNAL_MEDICINE']);
  });

  it('persists payload blocks on VERSION row (sample-data shape)', () => {
    const ctx = TemplateEntityBuilder.buildCreateContext({
      templateCode: 'ALT-VITALS-v1',
      templateName: 'Hypertension Vitals Alert Policy',
      templateType: 'ALERT_POLICY',
      status: 'SAVED',
    });
    const version = TemplateEntityBuilder.buildVersionRow(ctx, {
      templateCode: 'ALT-VITALS-v1',
      templateType: 'ALERT_POLICY',
      templateProfile: {
        category: 'Chronic Disease',
        condition: 'Hypertension',
        country: ['US'],
        language: ['EN'],
        specialty: ['Cardiology'],
      },
      templateMetadata: {
        templateName: 'Hypertension Vitals Alert Policy',
        status: 'Saved',
        shareScope: 'Private',
      },
      alertPolicyScopeDefinition: { appliesToType: 'Metric' },
    });

    expect(version.templateMetadata).toEqual(
      expect.objectContaining({ templateName: 'Hypertension Vitals Alert Policy', shareScope: 'Private' }),
    );
    expect(version.templateProfile).toEqual(
      expect.objectContaining({ condition: 'Hypertension' }),
    );
    expect(version.meta.templateName).toBe('Hypertension Vitals Alert Policy');
    expect(version.meta.countries).toEqual(['US']);
    expect(version.alertPolicyScopeDefinition).toEqual({ appliesToType: 'Metric' });
  });
});

describe('TemplateEntityBuilder.normalizeTemplateId', () => {
  it('normalizes template id from template code', () => {
    expect(TemplateEntityBuilder.normalizeTemplateId('CP_HTN_STANDARD')).toBe('CP-HTN-STANDARD');
  });

  it('uppercases mixed-case alert template codes', () => {
    expect(TemplateEntityBuilder.normalizeTemplateId('ALT-VITALS-v1')).toBe('ALT-VITALS-V1');
  });
});

describe('TemplateEntityBuilder.resolveMasterPathParam', () => {
  it('maps templateVersionId path to templateId', () => {
    expect(TemplateEntityBuilder.resolveMasterPathParam('TASK-CODE-V01')).toEqual({
      templateId: 'TASK-CODE',
      templateVersionId: 'TASK-CODE-V01',
    });
  });

  it('keeps templateId path unchanged', () => {
    expect(TemplateEntityBuilder.resolveMasterPathParam('TASK-CODE')).toEqual({
      templateId: 'TASK-CODE',
    });
  });
});

describe('version utils', () => {
  const { normalizeVersionToSk, templateVersionIdToSk } = jest.requireActual<
    typeof import('../utils/template.utils')
  >('../utils/template.utils');

  it('normalizes V01 to VERSION#001', () => {
    expect(normalizeVersionToSk('V01')).toBe('VERSION#001');
  });

  it('normalizes a full templateVersionId to VERSION#001', () => {
    expect(normalizeVersionToSk('TASK-CODE-V01')).toBe('VERSION#001');
    expect(normalizeVersionToSk('CP-HTN-STANDARD-V12')).toBe('VERSION#012');
  });

  it('maps templateVersionId to sort key', () => {
    expect(templateVersionIdToSk('CP-HTN-STANDARD-V01')).toBe('VERSION#001');
  });
});

describe('toMasterFullRecord', () => {
  const { toMasterFullRecord } = jest.requireActual<typeof import('../mappers/template-http.dto')>(
    '../mappers/template-http.dto',
  );

  it('includes nested document sections from VERSION row', () => {
    const ctx = TemplateEntityBuilder.buildCreateContext({
      templateCode: 'ALT-VITALS-v1',
      templateName: 'Alert',
      templateType: 'ALERT_POLICY',
      status: 'SAVED',
    });
    const row = TemplateEntityBuilder.buildVersionRow(ctx, {
      templateCode: 'ALT-VITALS-v1',
      templateName: 'Alert',
      templateType: 'ALERT_POLICY',
      templateMetadata: { templateName: 'Alert' },
      templateProfile: { condition: 'Hypertension' },
      alertPolicyScopeDefinition: { appliesToType: 'Metric' },
    });

    const full = toMasterFullRecord(row);
    expect(full.templateMetadata).toEqual(expect.objectContaining({ templateName: 'Alert' }));
    expect(full.templateProfile).toEqual(expect.objectContaining({ condition: 'Hypertension' }));
    expect(full.meta).toEqual(expect.objectContaining({ templateId: 'ALT-VITALS-V1' }));
    expect(full.alertPolicyScopeDefinition).toEqual({ appliesToType: 'Metric' });
  });
});

describe('TemplateService', () => {
  it('maps create response via toCreateResponse', () => {
    const svc = new TemplateService();
    const ctx = TemplateEntityBuilder.buildCreateContext({
      templateCode: 'CP_HTN_STANDARD',
      templateName: 'Test',
    });
    const record = TemplateEntityBuilder.buildVersionRow(ctx, {
      templateCode: 'CP_HTN_STANDARD',
      templateName: 'Test',
    });

    const full = svc.toCreateResponse(record);
    expect(full.meta).toEqual(
      expect.objectContaining({ templateId: 'CP-HTN-STANDARD', status: 'DRAFT' }),
    );
  });
});

function masterRow(opts: {
  code: string;
  status: string;
  condition?: string;
  scope?: string;
  version?: number;
  name?: string;
}): TemplateDdbRecord {
  const templateName = opts.name ?? opts.code;
  const ctx = TemplateEntityBuilder.buildCreateContext({
    templateCode: opts.code,
    templateName,
    templateType: 'TASK',
    status: opts.status as never,
    condition: opts.condition,
    version: opts.version,
  });
  const row = TemplateEntityBuilder.buildVersionRow(ctx, {
    templateCode: opts.code,
    templateName,
    templateType: 'TASK',
    shareScope: opts.scope,
  });
  row.meta.isActive = opts.status === 'PUBLISHED';
  return row;
}

describe('buildVersionHistory', () => {
  const { buildVersionHistory } = jest.requireActual<typeof import('../mappers/template-http.dto')>(
    '../mappers/template-http.dto',
  );

  it('builds newest-first timeline with create on lowest version', () => {
    const v1 = masterRow({ code: 'ALT-1', status: 'DRAFT', version: 1 });
    const v2Ctx = TemplateEntityBuilder.buildVersionWriteContext('ALT-1', 2);
    const v2Meta = TemplateEntityBuilder.buildMetaFromExisting(
      v1.meta,
      { status: 'PUBLISHED' as never, reviewComments: 'Approved' },
      v2Ctx,
      'admin-1',
    );
    const v2 = TemplateEntityBuilder.buildVersionRowFromMeta(v2Meta, v2Ctx, {});

    const history = buildVersionHistory([v1, v2]);
    expect(history).toHaveLength(2);
    expect(history[0].version).toBe(2);
    expect(history[0].title).toBe('Template Published');
    expect(history[1].title).toBe('Template Created');
    expect(history[0].changes).toEqual(['Approved']);
  });
});

describe('TemplateService.listMasterTemplates', () => {
  let spy: jest.SpyInstance;

  afterEach(() => spy?.mockRestore());

  function mockRows(rows: TemplateDdbRecord[]) {
    spy = jest
      .spyOn(TemplateRepository.prototype, 'listAllMasterVersionsAcrossStatuses')
      .mockResolvedValue(rows);
  }

  it('returns counts and filter options across the whole type scope', async () => {
    mockRows([
      masterRow({ code: 'T1', status: 'PUBLISHED', condition: 'Hypertension', scope: 'Public' }),
      masterRow({ code: 'T2', status: 'DRAFT', condition: 'Diabetes', scope: 'Private' }),
      masterRow({ code: 'T3', status: 'PUBLISHED', condition: 'Diabetes', scope: 'Organization' }),
      masterRow({ code: 'T4', status: 'SAVED', condition: 'Asthma', scope: 'Private' }),
    ]);

    const result = await new TemplateService().listMasterTemplates({ templateType: 'TASK' });

    expect(result.counts.total).toBe(4);
    expect(result.counts.published).toBe(2);
    expect(result.counts.draft).toBe(1);
    expect(result.counts.active).toBe(2);
    expect(result.counts.inactive).toBe(2);
    expect(result.counts.draft).toBe(1);
    expect(result.filterOptions.status.map((o) => o.value)).toContain('PUBLISHED');
    expect(result.filterOptions.scope.map((o) => o.value)).toEqual(['PRIVATE', 'ORGANIZATION', 'PUBLIC']);
    expect(result.filterOptions.condition.map((o) => o.value)).toEqual(
      expect.arrayContaining(['ASTHMA', 'DIABETES', 'HYPERTENSION']),
    );
    expect(result.items).toHaveLength(4);
    expect(result.items[0].history).toBeDefined();
    expect(Array.isArray(result.items[0].history)).toBe(true);
  });

  it('filters items by status, shareScope, and conditionCode without changing counts', async () => {
    mockRows([
      masterRow({ code: 'T1', status: 'PUBLISHED', condition: 'Hypertension', scope: 'Public' }),
      masterRow({ code: 'T2', status: 'DRAFT', condition: 'Diabetes', scope: 'Private' }),
      masterRow({ code: 'T3', status: 'PUBLISHED', condition: 'Diabetes', scope: 'Organization' }),
    ]);

    const byStatus = await new TemplateService().listMasterTemplates({
      templateType: 'TASK',
      status: 'PUBLISHED' as never,
    });
    expect(byStatus.items).toHaveLength(2);
    expect(byStatus.counts.total).toBe(3);

    const byCondition = await new TemplateService().listMasterTemplates({
      templateType: 'TASK',
      conditionCode: 'DIABETES',
    });
    expect(byCondition.items.map((i) => i.templateId).sort()).toEqual(['T2', 'T3']);

    const byScope = await new TemplateService().listMasterTemplates({
      templateType: 'TASK',
      shareScope: 'PUBLIC' as never,
    });
    expect(byScope.items.map((i) => i.templateId)).toEqual(['T1']);
  });

  it('filters items by templateName (id or partial display name)', async () => {
    mockRows([
      masterRow({
        code: 'TASK-MONITORING-MASTER',
        status: 'PUBLISHED',
        condition: 'Diabetes',
        scope: 'Organization',
        name: 'Record Blood Pressure (updated)',
      }),
      masterRow({ code: 'OTHER-TASK', status: 'DRAFT', condition: 'Asthma', scope: 'Private', name: 'Other Task' }),
    ]);

    const byName = await new TemplateService().listMasterTemplates({
      templateType: 'TASK',
      templateName: 'Blood Pressure',
    });
    expect(byName.items).toHaveLength(1);
    expect(byName.items[0].templateId).toBe('TASK-MONITORING-MASTER');

    const byId = await new TemplateService().listMasterTemplates({
      templateType: 'TASK',
      templateName: 'TASK-MONITORING-MASTER',
    });
    expect(byId.items).toHaveLength(1);
  });

  it('maps list item isActive from stored flag (published may be inactive)', async () => {
    const pubActive = masterRow({ code: 'PUB-ON', status: 'PUBLISHED' });
    const pubInactive = masterRow({ code: 'PUB-OFF', status: 'PUBLISHED' });
    pubInactive.meta.isActive = false;
    const draft = masterRow({ code: 'DRF', status: 'DRAFT' });
    mockRows([pubActive, pubInactive, draft]);

    const result = await new TemplateService().listMasterTemplates({ templateType: 'TASK' });
    expect(result.items.find((i) => i.templateId === 'PUB-ON')?.isActive).toBe(true);
    expect(result.items.find((i) => i.templateId === 'PUB-OFF')?.isActive).toBe(false);
    expect(result.items.find((i) => i.templateId === 'DRF')?.isActive).toBe(false);
    expect(result.counts.published).toBe(2);
    expect(result.counts.active).toBe(1);
    expect(result.counts.inactive).toBe(2);
    expect(result.counts.draft).toBe(1);
  });

  it('paginates with a stable nextToken', async () => {
    mockRows([
      masterRow({ code: 'T1', status: 'PUBLISHED' }),
      masterRow({ code: 'T2', status: 'PUBLISHED' }),
      masterRow({ code: 'T3', status: 'PUBLISHED' }),
    ]);

    const svc = new TemplateService();
    const page1 = await svc.listMasterTemplates({ templateType: 'TASK', limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.pagination.hasMore).toBe(true);
    expect(page1.pagination.total).toBe(3);
    expect(page1.pagination.nextToken).toBeDefined();

    const page2 = await svc.listMasterTemplates({
      templateType: 'TASK',
      limit: 2,
      nextToken: page1.pagination.nextToken,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.pagination.hasMore).toBe(false);
    expect(page2.pagination.nextToken).toBeUndefined();
  });
});
