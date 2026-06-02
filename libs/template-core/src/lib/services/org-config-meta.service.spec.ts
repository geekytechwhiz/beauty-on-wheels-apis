import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { OrgConfigMetaService } from './org-config-meta.service';

describe('OrgConfigMetaService', () => {
  it('creates with active and version defaults', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'org-config-meta-'));
    const svc = new OrgConfigMetaService(dir);

    const payload = {
      configKey: 'ENABLE_SCOPE',
      sections: [{ id: 'sec-1', name: 'Test' }],
      active: false,
    };

    const result = await svc.createOrgConfigMeta(payload);
    expect(result.document.active).toBe(false);
    expect(result.document.version).toBe(1);

    const stored = JSON.parse(await readFile(path.join(dir, 'enable-scope.json'), 'utf-8'));
    expect(stored.active).toBe(false);
    expect(stored.version).toBe(1);
  });

  it('increments version when omitted on update', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'org-config-meta-ver-'));
    await writeFile(
      path.join(dir, 'org-drawer.json'),
      JSON.stringify({ active: true, version: 2, examples: {} }),
      'utf-8',
    );
    const svc = new OrgConfigMetaService(dir);

    const updated = await svc.updateOrgConfigMeta('ORG_DRAWER', { examples: { a: 1 } });
    expect(updated.document.version).toBe(3);
  });

  it('creates custom org config key', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'org-config-custom-'));
    const svc = new OrgConfigMetaService(dir);

    const result = await svc.createOrgConfigMeta({
      configKey: 'CUSTOM_PANEL',
      sections: [],
      active: true,
    });
    expect(result.configKey).toBe('CUSTOM_PANEL');
    expect(result.fileName).toBe('org-config-custom-panel.json');
  });

  it('lists and reads by config key', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'org-config-meta-list-'));
    await writeFile(
      path.join(dir, 'org-manageibility.json'),
      JSON.stringify({ active: true, version: 1, sections: [] }),
      'utf-8',
    );
    const svc = new OrgConfigMetaService(dir);

    const items = await svc.listOrgConfigMeta();
    expect(items.some((i) => i.configKey === 'ORG_MANAGEABILITY')).toBe(true);

    const byKey = await svc.getOrgConfigMetaByKey('ORG_MANAGEIBILITY');
    expect(byKey.configKey).toBe('ORG_MANAGEABILITY');
  });
});
