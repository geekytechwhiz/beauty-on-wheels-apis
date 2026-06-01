import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { TemplateUiMetaService } from './template-ui-meta.service';

describe('TemplateUiMetaService', () => {
  it('upserts and reads UI meta by id', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ui-meta-'));
    const svc = new TemplateUiMetaService(dir);

    const payload = {
      id: 'ALERT-MASTER-001',
      titleKey: 'alert.title',
      subtitleKey: 'alert.subtitle',
      fields: { TEMPLATE_NAME: { id: 'TEMPLATE_NAME', type: 'text' } },
    };

    await svc.upsertUiMeta('ALERT_POLICY', payload);
    const stored = await readFile(path.join(dir, 'alert-api-response.json'), 'utf-8');
    expect(JSON.parse(stored).id).toBe('ALERT-MASTER-001');

    const byId = await svc.getUiMetaById('ALERT-MASTER-001');
    expect(byId.document.titleKey).toBe('alert.title');

    const byType = await svc.getUiMetaByTemplateType('ALERT_POLICY');
    expect(byType.metaId).toBe('ALERT-MASTER-001');
  });

  it('lists registered UI meta files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ui-meta-list-'));
    await writeFile(
      path.join(dir, 'goal-api-response.json'),
      JSON.stringify({
        id: 'GOAL-MASTER-001',
        fields: { A: { id: 'A' } },
      }),
      'utf-8',
    );
    const svc = new TemplateUiMetaService(dir);
    const items = await svc.listUiMeta();
    expect(items.some((i) => i.metaId === 'GOAL-MASTER-001')).toBe(true);
  });
});
