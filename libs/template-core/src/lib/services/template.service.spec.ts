import { TemplateEntityBuilder } from '../builder/template-entity.builder';
import { TemplateService } from './template.service';

describe('TemplateEntityBuilder', () => {
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

  it('maps OpenAPI specialties to meta.specialty', () => {
    const ctx = TemplateEntityBuilder.buildCreateContext({
      templateCode: 'CP_HTN_STANDARD',
      templateName: 'Plan',
      specialties: ['CARDIOLOGY', 'INTERNAL_MEDICINE'],
    });
    const meta = TemplateEntityBuilder.buildMeta(ctx);
    expect(meta.specialty).toEqual(['CARDIOLOGY', 'INTERNAL_MEDICINE']);
  });
});

describe('TemplateEntityBuilder.normalizeTemplateId', () => {
  it('normalizes template id from template code', () => {
    expect(TemplateEntityBuilder.normalizeTemplateId('CP_HTN_STANDARD')).toBe('CP-HTN-STANDARD');
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
