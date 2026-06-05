import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

import { NotFoundError } from '../../domain/errors';
import { encodeRelationId, relationPartitionKey, relationSortKey } from '../../domain/relation-keys';
import { RELATION_ENTITY_TYPE, RELATION_STATUS } from '../../models/relation-types';
import { DynamoDbRelationRepository } from './dynamodb-relation.repository';

describe('DynamoDbRelationRepository.updateRelationStatus', () => {
  const pk = relationPartitionKey('Country', 'US');
  const sk = relationSortKey('PARENT_CHILD', 'State', 'CA');

  function baseItem(status: typeof RELATION_STATUS.ACTIVE | typeof RELATION_STATUS.INACTIVE) {
    return {
      PK: pk,
      SK: sk,
      entityType: RELATION_ENTITY_TYPE,
      id: encodeRelationId(pk, sk),
      relationType: 'PARENT_CHILD' as const,
      fromMetadataTypeCode: 'Country',
      fromMetadataValueCode: 'US',
      toMetadataTypeCode: 'State',
      toMetadataValueCode: 'CA',
      status,
      createdAt: '2020-01-01T00:00:00.000Z',
    };
  }

  it('returns NotFoundError when the relation row does not exist', async () => {
    const doc = { send: jest.fn().mockResolvedValue({}) };
    const repo = new DynamoDbRelationRepository(doc, 'tbl');
    await expect(
      repo.updateRelationStatus(pk, sk, RELATION_STATUS.INACTIVE, 'actor'),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(doc.send).toHaveBeenCalledTimes(1);
    expect(doc.send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
  });

  it('no-ops when already ACTIVE and status ACTIVE (no transact write)', async () => {
    const item = baseItem(RELATION_STATUS.ACTIVE);
    const doc = {
      send: jest.fn(async (cmd: unknown) => {
        if (cmd instanceof GetCommand) {
          return { Item: item };
        }
        throw new Error(`unexpected command: ${(cmd as { constructor?: { name?: string } }).constructor?.name}`);
      }),
    };
    const repo = new DynamoDbRelationRepository(doc, 'tbl');
    const out = await repo.updateRelationStatus(pk, sk, RELATION_STATUS.ACTIVE);
    expect(out.status).toBe(RELATION_STATUS.ACTIVE);
    expect(doc.send).toHaveBeenCalledTimes(1);
  });

  it('no-ops when already INACTIVE and status INACTIVE', async () => {
    const item = baseItem(RELATION_STATUS.INACTIVE);
    const doc = {
      send: jest.fn(async (cmd: unknown) => {
        if (cmd instanceof GetCommand) {
          return { Item: item };
        }
        throw new Error(`unexpected command: ${(cmd as { constructor?: { name?: string } }).constructor?.name}`);
      }),
    };
    const repo = new DynamoDbRelationRepository(doc, 'tbl');
    const out = await repo.updateRelationStatus(pk, sk, RELATION_STATUS.INACTIVE);
    expect(out.status).toBe(RELATION_STATUS.INACTIVE);
    expect(doc.send).toHaveBeenCalledTimes(1);
  });

  it('inactivates ACTIVE -> INACTIVE and writes INACTIVATE audit', async () => {
    const activeItem = baseItem(RELATION_STATUS.ACTIVE);
    const doc = {
      send: jest.fn(async (cmd: unknown) => {
        if (cmd instanceof GetCommand) {
          return { Item: activeItem };
        }
        if (cmd instanceof TransactWriteCommand) {
          const items = (cmd as TransactWriteCommand).input?.TransactItems ?? [];
          const audit = items.find(
            (i) =>
              'Put' in i &&
              (i.Put?.Item as { action?: string } | undefined)?.action === 'INACTIVATE',
          );
          expect(audit).toBeDefined();
          return {};
        }
        throw new Error(`unexpected command: ${(cmd as { constructor?: { name?: string } }).constructor?.name}`);
      }),
    };
    const repo = new DynamoDbRelationRepository(doc, 'tbl');
    const out = await repo.updateRelationStatus(pk, sk, RELATION_STATUS.INACTIVE, 'user-1');
    expect(out.status).toBe(RELATION_STATUS.INACTIVE);
    expect(out.updatedBy).toBe('user-1');
    expect(doc.send).toHaveBeenCalledTimes(3);
    expect(doc.send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(doc.send.mock.calls[1][0]).toBeInstanceOf(GetCommand);
    expect(doc.send.mock.calls[2][0]).toBeInstanceOf(TransactWriteCommand);
  });

  it('reactivates INACTIVE -> ACTIVE and writes REACTIVATE audit', async () => {
    const inactiveItem = baseItem(RELATION_STATUS.INACTIVE);
    const doc = {
      send: jest.fn(async (cmd: unknown) => {
        if (cmd instanceof GetCommand) {
          return { Item: inactiveItem };
        }
        if (cmd instanceof TransactWriteCommand) {
          const items = (cmd as TransactWriteCommand).input?.TransactItems ?? [];
          const audit = items.find(
            (i) =>
              'Put' in i &&
              (i.Put?.Item as { action?: string } | undefined)?.action === 'REACTIVATE',
          );
          expect(audit).toBeDefined();
          return {};
        }
        throw new Error(`unexpected command: ${(cmd as { constructor?: { name?: string } }).constructor?.name}`);
      }),
    };
    const repo = new DynamoDbRelationRepository(doc, 'tbl');
    const out = await repo.updateRelationStatus(pk, sk, RELATION_STATUS.ACTIVE, 'user-2');
    expect(out.status).toBe(RELATION_STATUS.ACTIVE);
    expect(out.updatedBy).toBe('user-2');
    expect(doc.send).toHaveBeenCalledTimes(3);
    expect(doc.send.mock.calls[2][0]).toBeInstanceOf(TransactWriteCommand);
  });
});
