import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import {
  CAPACITY_CHANGE_STATUS,
  CHANGEABLE_COMMITMENT_STATUSES,
  CapacityChangeRequestDdbItem,
  CapacityChangeStatus,
  capacityChangeKeys,
} from '../domain/capacity-change';
import {
  CAPACITY_COMMITMENT_STATUS,
  CapacityCommitmentStatus,
  CapacityLedgerDdbItem,
} from '../domain/capacity-commitment';
import {
  CAPACITY_LEDGER_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';

export interface CapacityChangeIdempotencyItem {
  PK: string;
  SK: string;
  requestHash: string;
  requestId: string;
  vendorId: string;
  entityType: 'CapacityChangeIdempotency';
}

interface LookupItem {
  PK: string;
  SK: string;
  vendorId: string;
  entityType: 'CapacityChangeLookup';
}

/**
 * Transaction item order is part of the contract with CapacityChangeRequestsService.
 * CREATE_TX: idempotency, request, lookup, commitment update.
 */
export const CHANGE_CREATE_TX = { IDEMPOTENCY: 0, REQUEST: 1, LOOKUP: 2, COMMITMENT: 3 } as const;

/**
 * Persistence for capacity-change requests. The commitment rows themselves belong to
 * the capacity-proposals feature (CapacityCommitmentDdbItem); this repository only
 * flips their status/quantity inside the same transaction as the request.
 */
export class CapacityChangeRequestsRepository extends BaseRepository {
  getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getRequest(vendorId: string, requestId: string): Promise<CapacityChangeRequestDdbItem | null> {
    return this.get<CapacityChangeRequestDdbItem>(
      this.getTableName(),
      { PK: capacityChangeKeys.pk(vendorId), SK: capacityChangeKeys.sk(requestId) },
      { consistent: true },
    );
  }

  async getRequestById(requestId: string): Promise<CapacityChangeRequestDdbItem | null> {
    const lookup = await this.get<LookupItem>(
      this.getTableName(),
      { PK: capacityChangeKeys.lookupPk(requestId), SK: capacityChangeKeys.lookupSk() },
      { consistent: true },
    );
    return lookup ? this.getRequest(lookup.vendorId, requestId) : null;
  }

  async getIdempotency(vendorId: string, key: string): Promise<CapacityChangeIdempotencyItem | null> {
    return this.get<CapacityChangeIdempotencyItem>(this.getTableName(), {
      PK: capacityChangeKeys.idempotencyPk(vendorId, key),
      SK: capacityChangeKeys.idempotencySk(),
    }, { consistent: true });
  }

  async listVendorRequests(vendorId: string): Promise<CapacityChangeRequestDdbItem[]> {
    return this.queryAll<CapacityChangeRequestDdbItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': capacityChangeKeys.pk(vendorId),
        ':prefix': capacityChangeKeys.skPrefix(),
      },
      ScanIndexForward: false,
    });
  }

  async listByStatus(status: CapacityChangeStatus, limit: number): Promise<CapacityChangeRequestDdbItem[]> {
    const page = await this.queryPage<CapacityChangeRequestDdbItem>({
      TableName: this.getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': capacityChangeKeys.gsi1Pk(),
        ':prefix': `STATUS#${status}#`,
      },
      ScanIndexForward: false,
      Limit: limit,
    });
    return page.items;
  }

  /**
   * Files the request and moves the commitment to CHANGE_PENDING in one transaction.
   * Quantity is deliberately not touched. The commitment must still be ACTIVE/REDUCED
   * at the quantity the caller read and must not already have a pending change.
   */
  async createRequest(input: {
    item: CapacityChangeRequestDdbItem;
    idempotency: { key: string; requestHash: string };
    expectedCommitmentQuantity: number;
    updatedAt: string;
  }): Promise<void> {
    const { item } = input;
    const idempotency: CapacityChangeIdempotencyItem = {
      PK: capacityChangeKeys.idempotencyPk(item.vendorId, input.idempotency.key),
      SK: capacityChangeKeys.idempotencySk(),
      requestHash: input.idempotency.requestHash,
      requestId: item.requestId,
      vendorId: item.vendorId,
      entityType: 'CapacityChangeIdempotency',
    };
    const lookup: LookupItem = {
      PK: capacityChangeKeys.lookupPk(item.requestId),
      SK: capacityChangeKeys.lookupSk(),
      vendorId: item.vendorId,
      entityType: 'CapacityChangeLookup',
    };
    const holdable = CHANGEABLE_COMMITMENT_STATUSES.reduce<Record<string, CapacityCommitmentStatus>>(
      (acc, status, index) => ({ ...acc, [`:ok${index}`]: status }),
      {},
    );
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: idempotency,
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: lookup,
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
        {
          Update: {
            TableName: this.getTableName(),
            Key: commitmentKey(item.vendorId, item.commitmentId),
            UpdateExpression: 'SET #status = :pending, pendingChangeRequestId = :requestId, updatedAt = :now',
            ConditionExpression:
              `attribute_exists(PK) AND #status IN (${Object.keys(holdable).join(', ')})`
              + ' AND quantity = :quantity AND attribute_not_exists(pendingChangeRequestId)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ...holdable,
              ':pending': CAPACITY_COMMITMENT_STATUS.CHANGE_PENDING,
              ':requestId': item.requestId,
              ':quantity': input.expectedCommitmentQuantity,
              ':now': input.updatedAt,
            },
          },
        },
      ],
    });
  }

  /**
   * Approval. Writes the APPROVED request, the new commitment quantity/status, and bumps
   * the vendor capacity ledger so a concurrent proposal accept recomputes against the new
   * quantity. Fails (ConditionalWriteConflictError) if the request is no longer PENDING at
   * the version read, or if the commitment's quantity or sold count moved since it was read.
   */
  async approve(input: {
    item: CapacityChangeRequestDdbItem;
    expectedVersion: number;
    expectedQuantity: number;
    expectedSoldQuantity: number;
    newQuantity: number;
    newStatus: CapacityCommitmentStatus;
    salesBlocked: boolean;
    expectedLedgerVersion: number;
  }): Promise<void> {
    const { item } = input;
    const ledger: CapacityLedgerDdbItem = {
      PK: VendorKeyBuilder.vendorPk(item.vendorId),
      SK: VendorKeyBuilder.capacityLedgerSk(),
      vendorId: item.vendorId,
      version: input.expectedLedgerVersion + 1,
      updatedAt: item.updatedAt,
      entityType: CAPACITY_LEDGER_ENTITY_TYPE,
    };
    const ledgerPut: Record<string, unknown> = { TableName: this.getTableName(), Item: ledger };
    if (input.expectedLedgerVersion === 0) {
      ledgerPut.ConditionExpression = 'attribute_not_exists(PK)';
    } else {
      ledgerPut.ConditionExpression = '#version = :expectedLedgerVersion';
      ledgerPut.ExpressionAttributeNames = { '#version': 'version' };
      ledgerPut.ExpressionAttributeValues = { ':expectedLedgerVersion': input.expectedLedgerVersion };
    }
    await this.transactWrite({
      TransactItems: [
        { Put: this.requestVersionPut(item, input.expectedVersion) },
        {
          Update: {
            TableName: this.getTableName(),
            Key: commitmentKey(item.vendorId, item.commitmentId),
            UpdateExpression:
              'SET quantity = :newQuantity, #status = :newStatus, previousQuantity = :quantity,'
              + ' lastChangeRequestId = :requestId, updatedAt = :now'
              + `${input.salesBlocked ? ', salesBlocked = :true' : ''} REMOVE pendingChangeRequestId`,
            ConditionExpression:
              'attribute_exists(PK) AND #status = :pending AND pendingChangeRequestId = :requestId'
              + ' AND quantity = :quantity AND reservedSoldQuantity = :sold',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':newQuantity': input.newQuantity,
              ':newStatus': input.newStatus,
              ':pending': CAPACITY_COMMITMENT_STATUS.CHANGE_PENDING,
              ':requestId': item.requestId,
              ':quantity': input.expectedQuantity,
              ':sold': input.expectedSoldQuantity,
              ':now': item.updatedAt,
              ...(input.salesBlocked ? { ':true': true } : {}),
            },
          },
        },
        { Put: ledgerPut },
      ] as never,
    });
  }

  /** Rejection. Restores the commitment's prior status; quantity was never changed. */
  async reject(input: { item: CapacityChangeRequestDdbItem; expectedVersion: number }): Promise<void> {
    const { item } = input;
    await this.transactWrite({
      TransactItems: [
        { Put: this.requestVersionPut(item, input.expectedVersion) },
        {
          Update: {
            TableName: this.getTableName(),
            Key: commitmentKey(item.vendorId, item.commitmentId),
            UpdateExpression:
              'SET #status = :before, updatedAt = :now, lastChangeRequestId = :requestId REMOVE pendingChangeRequestId',
            ConditionExpression:
              'attribute_exists(PK) AND #status = :pending AND pendingChangeRequestId = :requestId',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':before': item.commitmentStatusBefore,
              ':pending': CAPACITY_COMMITMENT_STATUS.CHANGE_PENDING,
              ':requestId': item.requestId,
              ':now': item.updatedAt,
            },
          },
        },
      ],
    });
  }

  private requestVersionPut(item: CapacityChangeRequestDdbItem, expectedVersion: number) {
    return {
      TableName: this.getTableName(),
      Item: item,
      ConditionExpression: 'attribute_exists(PK) AND #version = :expectedVersion AND #status = :pending',
      ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
      ExpressionAttributeValues: {
        ':expectedVersion': expectedVersion,
        ':pending': CAPACITY_CHANGE_STATUS.PENDING,
      },
    };
  }
}

function commitmentKey(vendorId: string, commitmentId: string) {
  return {
    PK: VendorKeyBuilder.vendorPk(vendorId),
    SK: VendorKeyBuilder.capacityCommitmentSk(commitmentId),
  };
}

let repository: CapacityChangeRequestsRepository;

export function getCapacityChangeRequestsRepository() {
  if (!repository) repository = new CapacityChangeRequestsRepository();
  return repository;
}
