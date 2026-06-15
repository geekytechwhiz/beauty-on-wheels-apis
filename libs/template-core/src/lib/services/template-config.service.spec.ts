import type { S3Client } from '@aws-sdk/client-s3';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

import { TemplateConfigService } from './template-config.service';
import { TemplateConfigS3Store } from '../storage/template-config-s3.store';

function mockS3Client(handler: (command: unknown) => Promise<unknown>): S3Client {
  return { send: jest.fn(handler) } as unknown as S3Client;
}

describe('TemplateConfigService', () => {
  it('creates, gets, updates, and lists configs from S3', async () => {
    const objects = new Map<string, string>();

    const send = jest.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        const key = command.input.Key ?? '';
        if (!objects.has(key)) {
          const err = new Error('NotFound') as Error & { name: string };
          err.name = 'NotFound';
          throw err;
        }
        return {};
      }

      if (command instanceof PutObjectCommand) {
        const key = command.input.Key ?? '';
        objects.set(key, command.input.Body as string);
        return {};
      }

      if (command instanceof GetObjectCommand) {
        const key = command.input.Key ?? '';
        const body = objects.get(key);
        if (!body) {
          const err = new Error('NoSuchKey') as Error & { name: string };
          err.name = 'NoSuchKey';
          throw err;
        }
        return { Body: Readable.from([body]) };
      }

      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: [...objects.keys()].map((Key) => ({ Key })),
        };
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    const store = new TemplateConfigS3Store({
      bucket: 'test-bucket',
      prefix: 'template-configs',
      client: mockS3Client(send),
    });
    const svc = new TemplateConfigService(store);

    const created = await svc.createConfig({
      configType: 'TEMPLATE',
      templateType: 'GOAL',
      id: 'GOAL-MASTER-001',
      fields: { A: { id: 'A' } },
    });
    expect(created.configId).toBe('GOAL-MASTER-001');
    expect(created.configType).toBe('TEMPLATE');
    expect(created.templateType).toBe('GOAL');
    expect(created.document.configType).toBeUndefined();
    expect(created.document.templateType).toBeUndefined();

    const fetched = await svc.getConfigById('GOAL-MASTER-001');
    expect(fetched.configType).toBe('TEMPLATE');
    expect(fetched.templateType).toBe('GOAL');
    expect(fetched.document.fields).toEqual({ A: { id: 'A' } });

    const updated = await svc.updateConfig('GOAL-MASTER-001', {
      id: 'GOAL-MASTER-001',
      fields: { B: { id: 'B' } },
    });
    expect(updated.document.fields).toEqual({ B: { id: 'B' } });

    const listed = await svc.listConfigs();
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].configId).toBe('GOAL-MASTER-001');
  });

  it('rejects update when body.id does not match path configId', async () => {
    const send = jest.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        return {};
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const store = new TemplateConfigS3Store({
      bucket: 'test-bucket',
      prefix: 'template-configs',
      client: mockS3Client(send),
    });
    const svc = new TemplateConfigService(store);

    await expect(
      svc.updateConfig('GOAL-MASTER-001', { id: 'OTHER', fields: {} }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });
});
