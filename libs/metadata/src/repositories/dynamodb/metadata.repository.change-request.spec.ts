import { GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { CHANGE_REQUEST_OPERATION, CHANGE_REQUEST_STATUS } from '../../models/change-request.types';
import { DynamoDbMetadataRegistryRepository } from './metadata.repository.impl';

describe('DynamoDbMetadataRegistryRepository.saveChangeRequestDraft', () => {
  const now = '2026-06-01T00:00:00.000Z';

  const draftRecord = {
    changeRequestId: 'cr_new',
    status: CHANGE_REQUEST_STATUS.DRAFT,
    entityType: 'value' as const,
    operation: CHANGE_REQUEST_OPERATION.UPDATE,
    metadataTypeCode: 'MetricCode',
    metadataValueCode: 'BP_SYSTOLIC',
    baseVersion: 1,
    proposedPayload: { metadataTypeCode: 'MetricCode', metadataValueCode: 'BP_SYSTOLIC', label: 'BP' },
    createdAt: now,
    createdBy: 'admin',
    lastModifiedAt: now,
    lastModifiedBy: 'admin',
  };

  it('writes draft META and pointer without cancel when no prior draft', async () => {
    const doc = {
      send: jest.fn(async (cmd: unknown) => {
        if (cmd instanceof GetCommand) {
          return {};
        }
        if (cmd instanceof TransactWriteCommand) {
          const items = cmd.input?.TransactItems ?? [];
          expect(items).toHaveLength(2);
          return {};
        }
        throw new Error('unexpected command');
      }),
    };
    const repo = new DynamoDbMetadataRegistryRepository(doc, 'tbl');
    const out = await repo.saveChangeRequestDraft(draftRecord);
    expect(out.changeRequestId).toBe('cr_new');
    expect(doc.send).toHaveBeenCalledTimes(2);
  });

  it('cancels prior DRAFT and writes new draft when pointer exists', async () => {
    const doc = {
      send: jest.fn(async (cmd: unknown) => {
        if (cmd instanceof GetCommand) {
          const key = (cmd as GetCommand).input?.Key as Record<string, string>;
          if (key?.SK === 'CHANGE_REQUEST#DRAFT#VALUE#BP_SYSTOLIC') {
            return { Item: { changeRequestId: 'cr_old' } };
          }
          if (key?.PK === 'CHANGE_REQUEST#cr_old') {
            return {
              Item: {
                PK: 'CHANGE_REQUEST#cr_old',
                SK: 'META',
                changeRequestId: 'cr_old',
                status: CHANGE_REQUEST_STATUS.DRAFT,
                draftEntityType: 'value',
                operation: CHANGE_REQUEST_OPERATION.UPDATE,
                metadataTypeCode: 'MetricCode',
                metadataValueCode: 'BP_SYSTOLIC',
                baseVersion: 1,
                proposedPayload: {},
                createdAt: now,
                lastModifiedAt: now,
              },
            };
          }
          return {};
        }
        if (cmd instanceof TransactWriteCommand) {
          const items = cmd.input?.TransactItems ?? [];
          expect(items).toHaveLength(3);
          const cancel = items[0] as { Update?: { ExpressionAttributeValues?: Record<string, string> } };
          expect(cancel.Update?.ExpressionAttributeValues?.[':cancelled']).toBe(CHANGE_REQUEST_STATUS.CANCELLED);
          return {};
        }
        throw new Error('unexpected command');
      }),
    };
    const repo = new DynamoDbMetadataRegistryRepository(doc, 'tbl');
    await repo.saveChangeRequestDraft(draftRecord);
  });
});

describe('change request key helpers', () => {
  it('builds expected PK/SK patterns', async () => {
    const { MetadataKeyBuilder } = await import('../../builders/metadata-key.builder.js');
    expect(MetadataKeyBuilder.changeRequestPartitionKey('cr_123')).toBe('CHANGE_REQUEST#cr_123');
    expect(MetadataKeyBuilder.changeRequestMetaSortKey()).toBe('META');
    expect(MetadataKeyBuilder.changeRequestDraftPointerSortKey('type')).toBe('CHANGE_REQUEST#DRAFT#TYPE');
    expect(MetadataKeyBuilder.changeRequestDraftPointerSortKey('value', 'BP_SYSTOLIC')).toBe(
      'CHANGE_REQUEST#DRAFT#VALUE#BP_SYSTOLIC',
    );
    expect(MetadataKeyBuilder.changeRevisionCounterPartitionKey()).toBe('CHANGE_REVISION');
    expect(MetadataKeyBuilder.changeRevisionCounterSortKey()).toBe('GLOBAL');
  });
});

describe('DynamoDbMetadataRegistryRepository.markChangeRequestPublished', () => {
  const now = '2026-06-01T00:00:00.000Z';

  const draftItem = {
    PK: 'CHANGE_REQUEST#cr_pub',
    SK: 'META',
    changeRequestId: 'cr_pub',
    status: CHANGE_REQUEST_STATUS.DRAFT,
    draftEntityType: 'value',
    operation: CHANGE_REQUEST_OPERATION.UPDATE,
    metadataTypeCode: 'MetricCode',
    metadataValueCode: 'BP_SYSTOLIC',
    baseVersion: 1,
    proposedPayload: {},
    createdAt: now,
    lastModifiedAt: now,
  };

  it('reserves ChangeRevision and persists it on the published change request', async () => {
    let revisionCounter = 0;
    const doc = {
      send: jest.fn(async (cmd: unknown) => {
        if (cmd instanceof GetCommand) {
          const key = (cmd as GetCommand).input?.Key as Record<string, string>;
          if (key?.PK === 'CHANGE_REQUEST#cr_pub') {
            return { Item: draftItem };
          }
          return {};
        }
        if (cmd instanceof UpdateCommand) {
          revisionCounter += 1;
          return { Attributes: { changeRevision: revisionCounter } };
        }
        if (cmd instanceof TransactWriteCommand) {
          const items = cmd.input?.TransactItems ?? [];
          expect(items).toHaveLength(2);
          const put = items[0] as { Put?: { Item?: Record<string, unknown> } };
          expect(put.Put?.Item?.status).toBe(CHANGE_REQUEST_STATUS.PUBLISHED);
          expect(put.Put?.Item?.changeRevision).toBe(1);
          expect(put.Put?.Item?.publishedAt).toBe(now);
          return {};
        }
        throw new Error('unexpected command');
      }),
    };
    const repo = new DynamoDbMetadataRegistryRepository(doc, 'tbl');
    const out = await repo.markChangeRequestPublished('cr_pub', { actor: 'admin', publishedAt: now });
    expect(out.changeRevision).toBe(1);
    expect(out.publishedAt).toBe(now);
    expect(out.status).toBe(CHANGE_REQUEST_STATUS.PUBLISHED);
  });

  it('increments ChangeRevision on successive publishes', async () => {
    let revisionCounter = 5;
    const doc = {
      send: jest.fn(async (cmd: unknown) => {
        if (cmd instanceof GetCommand) {
          return { Item: draftItem };
        }
        if (cmd instanceof UpdateCommand) {
          revisionCounter += 1;
          return { Attributes: { changeRevision: revisionCounter } };
        }
        if (cmd instanceof TransactWriteCommand) {
          return {};
        }
        throw new Error('unexpected command');
      }),
    };
    const repo = new DynamoDbMetadataRegistryRepository(doc, 'tbl');
    const out = await repo.markChangeRequestPublished('cr_pub', { publishedAt: now });
    expect(out.changeRevision).toBe(6);
  });
});
