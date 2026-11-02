import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import {
  LEDGER_SOURCE,
  LedgerEntry,
  SettlementStatementDdbItem,
  StatementStatus,
  settlementKeys,
} from '../domain/settlement';

export interface SettlementIdempotencyItem {
  PK: string;
  SK: string;
  requestHash: string;
  statementId: string;
  vendorId: string;
  entityType: 'SettlementIdempotency';
}

interface LookupItem {
  PK: string;
  SK: string;
  vendorId: string;
  entityType: 'SettlementLookup';
}

export interface VisitLockItem {
  PK: string;
  SK: string;
  visitId: string;
  vendorId: string;
  statementId: string;
  entityType: 'SettlementVisitLock';
}

/** CREATE_TX item order: idempotency, statement, lookup, then (entry, lock?) pairs. */
export const SETTLEMENT_CREATE_TX = { IDEMPOTENCY: 0, STATEMENT: 1, LOOKUP: 2, FIRST_ENTRY: 3 } as const;

/**
 * Key layout (vendor table):
 *   statement      PK VENDOR#{vendorId}  SK SETTLEMENT_STATEMENT#{id}   GSI1 SETTLEMENT_STATEMENT / STATUS#{status}#{createdAt}#{id}
 *   ledger entry   PK VENDOR#{vendorId}  SK LEDGER_ENTRY#{entryId}
 *   id lookup      PK SETTLEMENT_STATEMENT#{id}  SK LOOKUP
 *   visit lock     PK SETTLEMENT_VISIT#{visitId} SK LOCK   (a visit is on at most one live statement)
 *   idempotency    PK IDEMPOTENCY#SETTLEMENT#{vendorId}#{key}  SK RECORD
 */
export class SettlementLedgerRepository extends BaseRepository {
  getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getStatement(vendorId: string, statementId: string): Promise<SettlementStatementDdbItem | null> {
    return this.get<SettlementStatementDdbItem>(
      this.getTableName(),
      { PK: settlementKeys.pk(vendorId), SK: settlementKeys.statementSk(statementId) },
      { consistent: true },
    );
  }

  async getStatementById(statementId: string): Promise<SettlementStatementDdbItem | null> {
    const lookup = await this.get<LookupItem>(
      this.getTableName(),
      { PK: settlementKeys.lookupPk(statementId), SK: settlementKeys.lookupSk() },
      { consistent: true },
    );
    return lookup ? this.getStatement(lookup.vendorId, statementId) : null;
  }

  async getIdempotency(vendorId: string, key: string): Promise<SettlementIdempotencyItem | null> {
    return this.get<SettlementIdempotencyItem>(this.getTableName(), {
      PK: settlementKeys.idempotencyPk(vendorId, key),
      SK: settlementKeys.idempotencySk(),
    }, { consistent: true });
  }

  async listVendorStatements(vendorId: string): Promise<SettlementStatementDdbItem[]> {
    return this.queryAll<SettlementStatementDdbItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': settlementKeys.pk(vendorId),
        ':prefix': settlementKeys.statementSkPrefix(),
      },
      ScanIndexForward: false,
    });
  }

  async listByStatus(status: StatementStatus, limit: number): Promise<SettlementStatementDdbItem[]> {
    const page = await this.queryPage<SettlementStatementDdbItem>({
      TableName: this.getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: { ':pk': settlementKeys.gsi1Pk(), ':prefix': `STATUS#${status}#` },
      ScanIndexForward: false,
      Limit: limit,
    });
    return page.items;
  }

  /**
   * One transaction: idempotency record, statement, id lookup, a ledger entry per line, and a
   * lock per visit line. A visit already locked by another live statement fails the whole write.
   */
  async createStatement(input: {
    statement: SettlementStatementDdbItem;
    idempotency: { key: string; requestHash: string };
  }): Promise<void> {
    const { statement } = input;
    const idempotency: SettlementIdempotencyItem = {
      PK: settlementKeys.idempotencyPk(statement.vendorId, input.idempotency.key),
      SK: settlementKeys.idempotencySk(),
      requestHash: input.idempotency.requestHash,
      statementId: statement.statementId,
      vendorId: statement.vendorId,
      entityType: 'SettlementIdempotency',
    };
    const lookup: LookupItem = {
      PK: settlementKeys.lookupPk(statement.statementId),
      SK: settlementKeys.lookupSk(),
      vendorId: statement.vendorId,
      entityType: 'SettlementLookup',
    };
    const notExists = 'attribute_not_exists(PK) AND attribute_not_exists(SK)';
    const entryItems = statement.entries.flatMap((entry) => {
      const puts: Array<Record<string, unknown>> = [{
        Put: {
          TableName: this.getTableName(),
          Item: {
            PK: settlementKeys.pk(statement.vendorId),
            SK: settlementKeys.entrySk(entry.entryId),
            statementId: statement.statementId,
            entityType: 'LedgerEntry',
            ...entry,
          },
          ConditionExpression: notExists,
        },
      }];
      if (entry.source === LEDGER_SOURCE.COMPLETED_VISIT && entry.visitId) {
        puts.push({
          Put: {
            TableName: this.getTableName(),
            Item: this.lock(statement, entry),
            ConditionExpression: notExists,
          },
        });
      }
      return puts;
    });
    await this.transactWrite({
      TransactItems: [
        { Put: { TableName: this.getTableName(), Item: idempotency, ConditionExpression: notExists } },
        { Put: { TableName: this.getTableName(), Item: statement, ConditionExpression: notExists } },
        { Put: { TableName: this.getTableName(), Item: lookup, ConditionExpression: notExists } },
        ...entryItems,
      ] as never,
    });
  }

  /**
   * Replaces a statement conditional on the version read. When `releaseVisitIds` is set
   * (rejection) the per-visit locks are deleted in the same transaction.
   */
  async saveStatement(input: {
    next: SettlementStatementDdbItem;
    expectedVersion: number;
    releaseVisitIds?: string[];
  }): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: input.next,
            ConditionExpression: 'attribute_exists(PK) AND #version = :expectedVersion',
            ExpressionAttributeNames: { '#version': 'version' },
            ExpressionAttributeValues: { ':expectedVersion': input.expectedVersion },
          },
        },
        ...(input.releaseVisitIds ?? []).map((visitId) => ({
          Delete: {
            TableName: this.getTableName(),
            Key: { PK: settlementKeys.visitLockPk(visitId), SK: settlementKeys.visitLockSk() },
            ConditionExpression: 'statementId = :statementId',
            ExpressionAttributeValues: { ':statementId': input.next.statementId },
          },
        })),
      ] as never,
    });
  }

  private lock(statement: SettlementStatementDdbItem, entry: LedgerEntry): VisitLockItem {
    return {
      PK: settlementKeys.visitLockPk(entry.visitId as string),
      SK: settlementKeys.visitLockSk(),
      visitId: entry.visitId as string,
      vendorId: statement.vendorId,
      statementId: statement.statementId,
      entityType: 'SettlementVisitLock',
    };
  }
}

let repository: SettlementLedgerRepository;

export function getSettlementLedgerRepository() {
  if (!repository) repository = new SettlementLedgerRepository();
  return repository;
}
