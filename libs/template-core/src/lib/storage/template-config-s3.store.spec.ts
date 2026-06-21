import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

import { TemplateConfigS3Store } from './template-config-s3.store';

function mockS3Client(handler: (command: unknown) => Promise<unknown>): S3Client {
  return { send: jest.fn(handler) } as unknown as S3Client;
}

describe('TemplateConfigS3Store', () => {
  const bucket = 'test-template-config-bucket';
  const prefix = 'template-configs';

  it('creates a new config object', async () => {
    const send = jest.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        const err = new Error('NotFound') as Error & { name: string };
        err.name = 'NotFound';
        throw err;
      }
      if (command instanceof PutObjectCommand) {
        return {};
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const store = new TemplateConfigS3Store({
      bucket,
      prefix,
      client: mockS3Client(send),
    });

    const body = { id: 'CARE-PLAN-MASTER-001', fields: {} };
    const created = await store.create('CARE-PLAN-MASTER-001', body);

    expect(created).toEqual({
      configId: 'CARE-PLAN-MASTER-001',
      document: body,
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('returns conflict when create target already exists', async () => {
    const send = jest.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        return {};
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const store = new TemplateConfigS3Store({
      bucket,
      prefix,
      client: mockS3Client(send),
    });

    await expect(
      store.create('CARE-PLAN-MASTER-001', { id: 'CARE-PLAN-MASTER-001' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('gets one config by id', async () => {
    const payload = { id: 'TASK-MASTER-001', fields: { A: 1 } };
    const send = jest.fn(async (command: unknown) => {
      if (command instanceof GetObjectCommand) {
        return {
          Body: Readable.from([JSON.stringify(payload)]),
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const store = new TemplateConfigS3Store({
      bucket,
      prefix,
      client: mockS3Client(send),
    });

    const row = await store.getById('TASK-MASTER-001');
    expect(row).toEqual({ configId: 'TASK-MASTER-001', document: payload });
  });

  it('lists all configs under prefix', async () => {
    const send = jest.fn(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: [{ Key: 'template-configs/A.json' }, { Key: 'template-configs/B.json' }],
        };
      }
      if (command instanceof GetObjectCommand) {
        const key = (command as GetObjectCommand).input.Key;
        const id = key?.replace('template-configs/', '').replace('.json', '');
        return {
          Body: Readable.from([JSON.stringify({ id, fields: {} })]),
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const store = new TemplateConfigS3Store({
      bucket,
      prefix,
      client: mockS3Client(send),
    });

    const items = await store.listAll();
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.configId).sort()).toEqual(['A', 'B']);
  });

  it('replaces an existing config', async () => {
    const updated = { id: 'GOAL-MASTER-001', fields: { updated: true } };
    const send = jest.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        return {};
      }
      if (command instanceof PutObjectCommand) {
        return {};
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const store = new TemplateConfigS3Store({
      bucket,
      prefix,
      client: mockS3Client(send),
    });

    const row = await store.replace('GOAL-MASTER-001', updated);
    expect(row).toEqual({ configId: 'GOAL-MASTER-001', document: updated });
  });

  it('returns not found when replacing missing config', async () => {
    const send = jest.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        const err = new Error('NotFound') as Error & { name: string };
        err.name = 'NotFound';
        throw err;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const store = new TemplateConfigS3Store({
      bucket,
      prefix,
      client: mockS3Client(send),
    });

    await expect(store.replace('MISSING', { id: 'MISSING' })).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });
});
