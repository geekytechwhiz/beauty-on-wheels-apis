import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { OrgConfigMetaService } from './org-config-meta.service';
import { TemplateConfigService } from './template-config.service';
import { TemplateUiMetaService } from './template-ui-meta.service';

describe('TemplateConfigService', () => {
  it('lists template configs by templateType query', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tpl-cfg-'));
    const ui = new TemplateUiMetaService(dir);
    await ui.createUiMeta({
      templateType: 'GOAL',
      id: 'GOAL-MASTER-001',
      fields: { A: { id: 'A' } },
    });

    const svc = new TemplateConfigService(ui, new OrgConfigMetaService(dir));
    const listed = await svc.listConfigs({ templateType: 'GOAL' });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].configId).toBe('GOAL-MASTER-001');
    expect(listed.items[0].configType).toBe('TEMPLATE');
  });

  it('creates and updates org config via unified API', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tpl-cfg-org-'));
    const svc = new TemplateConfigService(new TemplateUiMetaService(dir), new OrgConfigMetaService(dir));

    const created = await svc.createConfig({
      configType: 'ORG',
      configKey: 'CUSTOM_PANEL',
      sections: [],
    });
    expect(created.configId).toBe('CUSTOM_PANEL');
    expect(created.configType).toBe('ORG');

    const updated = await svc.updateConfig('CUSTOM_PANEL', { sections: [{ id: 's1' }] });
    expect(updated.document.version).toBe(2);
  });

  it('gets template config by configId', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tpl-cfg-get-'));
    const ui = new TemplateUiMetaService(dir);
    await ui.createUiMeta({
      templateType: 'TASK',
      id: 'TASK-MASTER-001',
      fields: {},
    });
    const svc = new TemplateConfigService(ui, new OrgConfigMetaService(dir));
    const row = await svc.getConfigById('TASK-MASTER-001');
    expect(row.templateType).toBe('TASK');
  });
});
