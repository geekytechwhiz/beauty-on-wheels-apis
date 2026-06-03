import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  prepareServicesJsonDir,
  resolveBundledServicesJsonDir,
  resolveServicesJsonDir,
  seedServicesJsonFromBundle,
} from './template-ui-meta.utils';

describe('template-ui-meta.utils', () => {
  const prevLambda = process.env.AWS_LAMBDA_FUNCTION_NAME;
  const prevMetaDir = process.env.TEMPLATE_UI_META_DIR;
  const prevTaskRoot = process.env.LAMBDA_TASK_ROOT;

  afterEach(() => {
    if (prevLambda === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    else process.env.AWS_LAMBDA_FUNCTION_NAME = prevLambda;
    if (prevMetaDir === undefined) delete process.env.TEMPLATE_UI_META_DIR;
    else process.env.TEMPLATE_UI_META_DIR = prevMetaDir;
    if (prevTaskRoot === undefined) delete process.env.LAMBDA_TASK_ROOT;
    else process.env.LAMBDA_TASK_ROOT = prevTaskRoot;
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

  it('keeps absolute windows TEMPLATE_UI_META_DIR under offline lambda env', () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'template-service-dev-test';
    process.env.TEMPLATE_UI_META_DIR =
      'C:\\Users\\MehulManubhaiChhotal\\Documents\\api-hub\\apps\\template-service\\services-json';
    expect(resolveServicesJsonDir().replace(/\\/g, '/')).toContain(
      '/Users/MehulManubhaiChhotal/Documents/api-hub/apps/template-service/services-json',
    );
    expect(resolveServicesJsonDir().replace(/\\/g, '/').startsWith('/tmp/')).toBe(false);
  });

  it('resolveBundledServicesJsonDir returns LAMBDA_TASK_ROOT/services-json on Lambda', async () => {
    const taskRoot = await mkdtemp(path.join(tmpdir(), 'lambda-task-'));
    const bundledDir = path.join(taskRoot, 'services-json');
    await mkdir(bundledDir, { recursive: true });
    await writeFile(path.join(bundledDir, 'seed.json'), '{"id":"SEED-001"}');

    process.env.AWS_LAMBDA_FUNCTION_NAME = 'template-service-dev-test';
    process.env.LAMBDA_TASK_ROOT = taskRoot;

    expect(resolveBundledServicesJsonDir()).toBe(bundledDir);
  });

  it('seedServicesJsonFromBundle copies missing json files from bundle', async () => {
    const taskRoot = await mkdtemp(path.join(tmpdir(), 'lambda-task-'));
    const bundledDir = path.join(taskRoot, 'services-json');
    await mkdir(bundledDir, { recursive: true });
    await writeFile(path.join(bundledDir, 'alert-api-response.json'), '{"id":"ALERT-MASTER-001"}');
    await writeFile(path.join(bundledDir, 'task-api-response.json'), '{"id":"TASK-MASTER-001"}');

    const targetDir = await mkdtemp(path.join(tmpdir(), 'services-json-target-'));

    process.env.AWS_LAMBDA_FUNCTION_NAME = 'template-service-dev-test';
    process.env.LAMBDA_TASK_ROOT = taskRoot;

    await seedServicesJsonFromBundle(targetDir);

    const alert = await readFile(path.join(targetDir, 'alert-api-response.json'), 'utf-8');
    expect(JSON.parse(alert).id).toBe('ALERT-MASTER-001');
    await access(path.join(targetDir, 'task-api-response.json'));
  });

  it('seedServicesJsonFromBundle does not overwrite existing files in target', async () => {
    const taskRoot = await mkdtemp(path.join(tmpdir(), 'lambda-task-'));
    const bundledDir = path.join(taskRoot, 'services-json');
    await mkdir(bundledDir, { recursive: true });
    await writeFile(
      path.join(bundledDir, 'alert-api-response.json'),
      '{"id":"ALERT-MASTER-001","from":"bundle"}',
    );

    const targetDir = await mkdtemp(path.join(tmpdir(), 'services-json-target-'));
    await writeFile(
      path.join(targetDir, 'alert-api-response.json'),
      '{"id":"ALERT-MASTER-001","from":"runtime"}',
    );

    process.env.AWS_LAMBDA_FUNCTION_NAME = 'template-service-dev-test';
    process.env.LAMBDA_TASK_ROOT = taskRoot;

    await seedServicesJsonFromBundle(targetDir);

    const alert = await readFile(path.join(targetDir, 'alert-api-response.json'), 'utf-8');
    expect(JSON.parse(alert).from).toBe('runtime');
  });

  it('prepareServicesJsonDir seeds bundled json on Lambda', async () => {
    const taskRoot = await mkdtemp(path.join(tmpdir(), 'lambda-task-'));
    const bundledDir = path.join(taskRoot, 'services-json');
    await mkdir(bundledDir, { recursive: true });
    await writeFile(
      path.join(bundledDir, 'monitoring-api-response.json'),
      '{"id":"MONITORING-MASTER-001"}',
    );

    const targetDir = await mkdtemp(path.join(tmpdir(), 'services-json-target-'));

    process.env.AWS_LAMBDA_FUNCTION_NAME = 'template-service-dev-test';
    process.env.LAMBDA_TASK_ROOT = taskRoot;

    const ready = await prepareServicesJsonDir(targetDir);
    expect(ready).toBe(targetDir);

    const monitoring = await readFile(
      path.join(targetDir, 'monitoring-api-response.json'),
      'utf-8',
    );
    expect(JSON.parse(monitoring).id).toBe('MONITORING-MASTER-001');
  });
});
