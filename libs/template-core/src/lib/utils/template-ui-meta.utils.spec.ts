import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  prepareServicesJsonDir,
  resolveServicesJsonDir,
} from './template-ui-meta.utils';

describe('template-ui-meta.utils', () => {
  const prevLambda = process.env.AWS_LAMBDA_FUNCTION_NAME;
  const prevMetaDir = process.env.TEMPLATE_UI_META_DIR;

  afterEach(() => {
    if (prevLambda === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    else process.env.AWS_LAMBDA_FUNCTION_NAME = prevLambda;
    if (prevMetaDir === undefined) delete process.env.TEMPLATE_UI_META_DIR;
    else process.env.TEMPLATE_UI_META_DIR = prevMetaDir;
  });

  it('uses /tmp on Lambda instead of /var/task', () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'template-service-dev-test';
    process.env.TEMPLATE_UI_META_DIR = 'services-json';
    expect(resolveServicesJsonDir().replace(/\\/g, '/')).toBe('/tmp/template-service/services-json');
  });

  it('prepareServicesJsonDir creates writable directory on Lambda', async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'template-service-dev-test';
    const dir = await prepareServicesJsonDir('/tmp/template-service/services-json-test');
    expect(dir).toContain('/tmp/template-service/');
    await writeFile(path.join(dir, 'probe.json'), '{}', 'utf-8');
  });

  it('prepareServicesJsonDir works for explicit local temp dir', async () => {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    const dir = await mkdtemp(path.join(tmpdir(), 'services-json-'));
    const ready = await prepareServicesJsonDir(dir);
    expect(ready).toBe(dir);
  });
});
