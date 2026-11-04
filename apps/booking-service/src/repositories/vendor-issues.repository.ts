import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import {
  IssueIdempotencyItem,
  VENDOR_ISSUE_STATUS,
  VendorIssueDdbItem,
  VendorIssueRecord,
  VendorIssueStatus,
  VisitIssueLinkItem,
} from '../types/vendor-issue.types';

/**
 * Key layout (shared booking table):
 *   issue             PK VENDOR_ISSUE#{vendorId}  SK ISSUE#{issueId}
 *                     GSI1 ISSUE_STATUS#{status} / {createdAt}#{issueId}   (ops queue by status)
 *                     GSI2 ISSUE#{issueId} / META                          (lookup by id)
 *   visit link        PK VISIT_ISSUE#{visitId}    SK ISSUE#{issueId}        (consistent blocking check)
 *   idempotency       PK ISSUE_IDEMPOTENCY#{vendorId}#{key}  SK ISSUE_IDEMPOTENCY
 */
export class VendorIssuesRepository extends BaseRepository {
  getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getIssue(vendorId: string, issueId: string): Promise<VendorIssueRecord | null> {
    const item = await this.get<VendorIssueDdbItem>(this.getTableName(), issueKey(vendorId, issueId));
    return item ? toRecord(item) : null;
  }

  async getIssueById(issueId: string): Promise<VendorIssueRecord | null> {
    const item = await this.queryOne<VendorIssueDdbItem>({
      TableName: this.getTableName(),
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK = :sk',
      ExpressionAttributeValues: { ':pk': `ISSUE#${issueId}`, ':sk': 'META' },
    });
    return item ? toRecord(item) : null;
  }

  async getIdempotency(vendorId: string, key: string): Promise<IssueIdempotencyItem | null> {
    return this.get<IssueIdempotencyItem>(this.getTableName(), idempotencyKey(vendorId, key));
  }

  async createIssue(record: VendorIssueRecord, idempotency: { key: string; requestHash: string }): Promise<void> {
    const pointer: IssueIdempotencyItem = {
      ...idempotencyKey(record.vendorId, idempotency.key),
      issueId: record.issueId,
      vendorId: record.vendorId,
      requestHash: idempotency.requestHash,
      entityType: 'VendorIssueIdempotency',
    };
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: toItem(record),
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: pointer,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        ...(record.visitId ? [this.linkPut(record)] : []),
      ],
    });
  }

  /** Optimistic write. Throws ConditionalWriteConflictError when another writer bumped the version. */
  async saveIssue(next: VendorIssueRecord, expectedVersion: number): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: toItem(next),
            ConditionExpression: 'version = :expectedVersion',
            ExpressionAttributeValues: { ':expectedVersion': expectedVersion },
          },
        },
        ...(next.visitId ? [this.linkPut(next)] : []),
      ],
    });
  }

  async listVendorIssues(vendorId: string): Promise<VendorIssueRecord[]> {
    const items = await this.queryAll<VendorIssueDdbItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `VENDOR_ISSUE#${vendorId}`, ':prefix': 'ISSUE#' },
      ScanIndexForward: false,
    });
    return items.map(toRecord);
  }

  async listVisitIssues(vendorId: string, visitId: string): Promise<VendorIssueRecord[]> {
    const links = await this.listVisitLinks(visitId);
    const issues = await Promise.all(
      links.filter((link) => link.vendorId === vendorId).map((link) => this.getIssue(vendorId, link.issueId)),
    );
    return issues.filter((issue): issue is VendorIssueRecord => Boolean(issue));
  }

  /** Strongly consistent. Returns the links whose status blocks completion. */
  async listBlockingVisitIssues(visitId: string): Promise<VisitIssueLinkItem[]> {
    const links = await this.listVisitLinks(visitId);
    return links.filter((link) => link.status !== VENDOR_ISSUE_STATUS.RESOLVED);
  }

  /** Ops queue. Most recent first. Capped per status; narrow with the status filter. */
  async listByStatus(
    status: VendorIssueStatus,
    limit: number,
  ): Promise<{ items: VendorIssueRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const page = await this.queryPage<VendorIssueDdbItem>({
      TableName: this.getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `ISSUE_STATUS#${status}` },
      ScanIndexForward: false,
      Limit: limit,
    });
    return { items: page.items.map(toRecord), lastEvaluatedKey: page.lastEvaluatedKey };
  }

  private async listVisitLinks(visitId: string): Promise<VisitIssueLinkItem[]> {
    return this.queryAll<VisitIssueLinkItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `VISIT_ISSUE#${visitId}`, ':prefix': 'ISSUE#' },
      ConsistentRead: true,
    });
  }

  private linkPut(record: VendorIssueRecord) {
    const link: VisitIssueLinkItem = {
      PK: `VISIT_ISSUE#${record.visitId}`,
      SK: `ISSUE#${record.issueId}`,
      issueId: record.issueId,
      vendorId: record.vendorId,
      visitId: record.visitId as string,
      status: record.status,
      updatedAt: record.updatedAt,
      entityType: 'VisitIssueLink',
    };
    return { Put: { TableName: this.getTableName(), Item: link } };
  }
}

function issueKey(vendorId: string, issueId: string) {
  return { PK: `VENDOR_ISSUE#${vendorId}`, SK: `ISSUE#${issueId}` };
}

function idempotencyKey(vendorId: string, key: string) {
  return { PK: `ISSUE_IDEMPOTENCY#${vendorId}#${key}`, SK: 'ISSUE_IDEMPOTENCY' };
}

function toItem(record: VendorIssueRecord): VendorIssueDdbItem {
  return {
    ...issueKey(record.vendorId, record.issueId),
    GSI1PK: `ISSUE_STATUS#${record.status}`,
    GSI1SK: `${record.createdAt}#${record.issueId}`,
    GSI2PK: `ISSUE#${record.issueId}`,
    GSI2SK: 'META',
    entityType: 'VendorIssue',
    ...record,
  };
}

function toRecord(item: VendorIssueDdbItem): VendorIssueRecord {
  const {
    PK: _pk, SK: _sk, GSI1PK: _g1pk, GSI1SK: _g1sk, GSI2PK: _g2pk, GSI2SK: _g2sk, entityType: _type,
    ...record
  } = item;
  return record;
}

let repository: VendorIssuesRepository;

export function getVendorIssuesRepository() {
  if (!repository) repository = new VendorIssuesRepository();
  return repository;
}
