import { TemplateEntityBuilder } from '../builder/template-entity.builder';
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

    const summary = svc.toCreateResponse(record);
    expect(summary.templateId).toBe('CP-HTN-STANDARD');
    expect(summary.status).toBe('DRAFT');
  });
});
