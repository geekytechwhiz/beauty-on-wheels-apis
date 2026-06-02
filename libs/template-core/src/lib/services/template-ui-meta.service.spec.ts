import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { TemplateUiMetaService } from './template-ui-meta.service';

describe('TemplateUiMetaService', () => {
  it('creates, updates, and reads UI meta by id', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ui-meta-'));
    const svc = new TemplateUiMetaService(dir);

    const payload = {
      id: 'ALERT-MASTER-001',
      titleKey: 'alert.title',
      subtitleKey: 'alert.subtitle',
      fields: { TEMPLATE_NAME: { id: 'TEMPLATE_NAME', type: 'text' } },
    };

    await svc.createUiMeta({ templateType: 'ALERT_POLICY', ...payload });
    const stored = await readFile(path.join(dir, 'alert-api-response.json'), 'utf-8');
    expect(JSON.parse(stored).id).toBe('ALERT-MASTER-001');

    const byId = await svc.getUiMetaById('ALERT-MASTER-001');
    expect(byId.document.titleKey).toBe('alert.title');
    expect(byId.metaId).toBe('ALERT-MASTER-001');

    await svc.updateUiMeta('ALERT_POLICY', { ...payload, titleKey: 'alert.updated' });
    const byType = await svc.getUiMetaByTemplateType('ALERT_POLICY');
    expect(byType.metaId).toBe('ALERT-MASTER-001');
    expect(byType.document.titleKey).toBe('alert.updated');
  });

  it('creates custom template type CARE_PLAN', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ui-meta-care-'));
    const svc = new TemplateUiMetaService(dir);

    await svc.createUiMeta({
      templateType: 'CARE_PLAN',
      id: 'CARE-PLAN-MASTER-001',
      fields: { NAME: { id: 'NAME', type: 'text' } },
    });

    const result = await svc.getUiMetaByTemplateType('CARE_PLAN');
    expect(result.templateType).toBe('CARE_PLAN');
    expect(result.fileName).toBe('care-plan-api-response.json');
  });

  it('rejects create when file exists', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ui-meta-conflict-'));
    await writeFile(
      path.join(dir, 'goal-api-response.json'),
      JSON.stringify({ id: 'GOAL-MASTER-001', fields: {} }),
      'utf-8',
    );
    const svc = new TemplateUiMetaService(dir);

    await expect(
      svc.createUiMeta({
        templateType: 'GOAL',
        id: 'GOAL-MASTER-002',
        fields: {},
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('lists registered UI meta files and skips org config', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ui-meta-list-'));
    await writeFile(
      path.join(dir, 'goal-api-response.json'),
      JSON.stringify({
        id: 'GOAL-MASTER-001',
        fields: { A: { id: 'A' } },
      }),
      'utf-8',
    );
    await writeFile(
      path.join(dir, 'enable-scope.json'),
      JSON.stringify({ active: true, version: 1, sections: [] }),
      'utf-8',
    );
    const svc = new TemplateUiMetaService(dir);
    const items = await svc.listUiMeta();
    expect(items.some((i) => i.metaId === 'GOAL-MASTER-001')).toBe(true);
    expect(items.every((i) => i.metaId !== 'enable-scope')).toBe(true);
  });

  it('resolves get by id when path uses template type', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ui-meta-type-id-'));
    await writeFile(
      path.join(dir, 'monitoring-api-response.json'),
      JSON.stringify({
        id: 'MONITORING-MASTER-001',
        fields: { A: { id: 'A' } },
      }),
      'utf-8',
    );
    const svc = new TemplateUiMetaService(dir);
    const result = await svc.getUiMetaById('MONITORING');
    expect(result.metaId).toBe('MONITORING-MASTER-001');
  });
});
