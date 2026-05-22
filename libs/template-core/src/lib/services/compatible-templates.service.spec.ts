import { TemplateEntityBuilder } from '../builder/template-entity.builder';
import { TEMPLATE_STATUS } from '../constants/template.constants';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { CompatibleTemplatesService } from './compatible-templates.service';

function publishedRow(overrides: Partial<TemplateDdbRecord['meta']> = {}): TemplateDdbRecord {
  const ctx = TemplateEntityBuilder.buildCreateContext({
    templateCode: 'CP_HTN_STANDARD',
    templateName: 'Hypertension Plan',
    status: TEMPLATE_STATUS.PUBLISHED,
  });
  const row = TemplateEntityBuilder.buildVersionRow(ctx, {
    templateCode: 'CP_HTN_STANDARD',
    templateName: 'Hypertension Plan',
  });
  row.meta = {
    ...row.meta,
    status: TEMPLATE_STATUS.PUBLISHED,
    condition: 'HYPERTENSION',
    countries: ['IN'],
    publishedAt: '2024-04-01T00:00:00Z',
    ...overrides,
  };
  row.carePlanAttributes = { duration: { durationType: 'MONTHS_6' } };
  return row;
}

describe('CompatibleTemplatesService.listCompatibleTemplates', () => {
  it('filters published templates by condition, country, and duration in app layer', async () => {
    const match = publishedRow({ templateId: 'CP-HTN-001', templateVersionId: 'CP-HTN-001-V01' });
    const wrongCountry = publishedRow({
      templateId: 'CP-HTN-002',
      templateVersionId: 'CP-HTN-002-V01',
      countries: ['US'],
    });
    const draft = publishedRow({
      templateId: 'CP-HTN-003',
      templateVersionId: 'CP-HTN-003-V01',
    });
    draft.meta.status = TEMPLATE_STATUS.DRAFT;

    const repo = {
      queryMasterCatalogGsi2Page: jest.fn().mockResolvedValue({
        items: [match, wrongCountry, draft],
      }),
    };

    const svc = new CompatibleTemplatesService(repo as never);
    const result = await svc.listCompatibleTemplates({
      condition: 'HYPERTENSION',
      country: 'IN',
      duration: 'MONTHS_6',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].templateId).toBe('CP-HTN-001');
    expect(result.items[0].duration).toBe('MONTHS_6');
    expect(repo.queryMasterCatalogGsi2Page).toHaveBeenCalledWith(
      'CARE_PLAN',
      expect.objectContaining({ limit: 50 }),
    );
  });

  it('rejects when condition or country missing', async () => {
    const repo = { queryMasterCatalogGsi2Page: jest.fn() };
    const svc = new CompatibleTemplatesService(repo as never);

    await expect(
      svc.listCompatibleTemplates({ condition: '', country: 'IN' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
