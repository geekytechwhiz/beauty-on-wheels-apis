import { BaseRepository } from '@api-hub/utils';
import { QueryCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import {
  CustomerPlanDdbItem,
  CustomerPlanIdempotencyItem,
  CustomerPlanRecord,
  PlanPaymentDdbItem,
  PlanPaymentIdempotencyItem,
  PlanPaymentRecord,
} from '../types/customer-plan.types';
import {
  PackageVisitDdbItem,
  PackageVisitRecord,
} from '../types/package-visit.types';

/**
 * Key layout (shared booking table):
 *   plan            PK CUSTOMER_PLAN#{planId}  SK PLAN#{planId}          GSI1 CUSTOMER#{customerId} / PLAN#{createdAt}#{planId}
 *   plan payment    PK CUSTOMER_PLAN#{planId}  SK PAYMENT#{paymentId}    GSI1 CUSTOMER#{customerId} / PLAN_PAYMENT#{createdAt}#{paymentId}
 *   package visit   PK CUSTOMER_PLAN#{planId}  SK VISIT#{ordinal:03d}#{visitId}
 *                   GSI1 VENDOR#{vendorId} / VISIT#{date|UNSCHEDULED}#{startTime|0000}#{visitId}
 *                   GSI2 VISIT#{visitId} / META
 *                   GSI3 (when scheduled) VENDOR#{vendorId}#DATE#{date} / VISIT#{startTime}#{visitId}
 *   plan idempotency  PK PLAN_IDEMPOTENCY#{customerId}#{key}  SK PLAN_IDEMPOTENCY
 * The customer GSI1 prefix `PLAN#` never collides with the `BOOKING#` and
 * `PAYMENT#` prefixes already used on `CUSTOMER#{customerId}`.
 */
export class CustomerPlansRepository extends BaseRepository {
  getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getPlan(planId: string): Promise<CustomerPlanRecord | null> {
    const item = await this.get<CustomerPlanDdbItem>(this.getTableName(), planKey(planId));
    return item ? toPlanRecord(item) : null;
  }

  async getIdempotency(customerId: string, idempotencyKey: string): Promise<CustomerPlanIdempotencyItem | null> {
    return this.get<CustomerPlanIdempotencyItem>(this.getTableName(), {
      PK: `PLAN_IDEMPOTENCY#${customerId}#${idempotencyKey}`,
      SK: 'PLAN_IDEMPOTENCY',
    });
  }

  /** Access pattern: customer plans via GSI1 (GSI1PK = CUSTOMER#id, GSI1SK begins_with PLAN#). */
  async listCustomerPlans(customerId: string): Promise<CustomerPlanRecord[]> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': `CUSTOMER#${customerId}`,
        ':prefix': 'PLAN#',
      },
      ScanIndexForward: false,
    };
    const items = await this.queryAll<CustomerPlanDdbItem>(params);
    return items.map(toPlanRecord);
  }

  async createPlan(record: CustomerPlanRecord, requestHash: string, idempotencyKey: string): Promise<CustomerPlanRecord> {
    const idempotency: CustomerPlanIdempotencyItem = {
      PK: `PLAN_IDEMPOTENCY#${record.customerId}#${idempotencyKey}`,
      SK: 'PLAN_IDEMPOTENCY',
      planId: record.planId,
      customerId: record.customerId,
      requestHash,
      entityType: 'CustomerPlanIdempotency',
    };
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: toPlanItem(record),
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: idempotency,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ],
    });
    return record;
  }

  /** Optimistic write: fails with ConditionalWriteConflictError when another writer bumped the version. */
  async savePlan(next: CustomerPlanRecord, expectedVersion: number): Promise<CustomerPlanRecord> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: toPlanItem(next),
            ConditionExpression: 'version = :expectedVersion',
            ExpressionAttributeValues: { ':expectedVersion': expectedVersion },
          },
        },
      ],
    });
    return next;
  }

  // --- Plan payments -----------------------------------------------------

  async getPayment(planId: string, paymentId: string): Promise<PlanPaymentRecord | null> {
    const item = await this.get<PlanPaymentDdbItem>(this.getTableName(), paymentKey(planId, paymentId));
    return item ? toPaymentRecord(item) : null;
  }

  async getIdempotentPayment(customerId: string, planId: string, idempotencyKey: string): Promise<PlanPaymentRecord | null> {
    const pointer = await this.get<PlanPaymentIdempotencyItem>(this.getTableName(), {
      PK: `PLAN_PAYMENT_IDEMPOTENCY#${customerId}#${planId}#${idempotencyKey}`,
      SK: 'PLAN_PAYMENT_IDEMPOTENCY',
    });
    return pointer ? this.getPayment(planId, pointer.paymentId) : null;
  }

  async createPayment(record: PlanPaymentRecord): Promise<PlanPaymentRecord> {
    const idempotency: PlanPaymentIdempotencyItem = {
      PK: `PLAN_PAYMENT_IDEMPOTENCY#${record.customerId}#${record.planId}#${record.idempotencyKey}`,
      SK: 'PLAN_PAYMENT_IDEMPOTENCY',
      paymentId: record.paymentId,
      planId: record.planId,
      customerId: record.customerId,
      entityType: 'CustomerPlanPaymentIdempotency',
    };
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: toPaymentItem(record),
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: idempotency,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ],
    });
    return record;
  }

  async savePayment(record: PlanPaymentRecord): Promise<PlanPaymentRecord> {
    await this.put(this.getTableName(), toPaymentItem(record));
    return record;
  }

  // --- Package visits ----------------------------------------------------

  async listVisits(planId: string): Promise<PackageVisitRecord[]> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `CUSTOMER_PLAN#${planId}`,
        ':prefix': 'VISIT#',
      },
      ScanIndexForward: true,
    };
    const items = await this.queryAll<PackageVisitDdbItem>(params);
    return items.map(toVisitRecord);
  }

  async listVisitsPage(
    planId: string,
    options: { limit: number; exclusiveStartKey?: Record<string, unknown> },
  ): Promise<{ items: PackageVisitRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const page = await this.queryPage<PackageVisitDdbItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `CUSTOMER_PLAN#${planId}`,
        ':prefix': 'VISIT#',
      },
      ScanIndexForward: true,
      Limit: options.limit,
      ...(options.exclusiveStartKey
        ? { ExclusiveStartKey: options.exclusiveStartKey }
        : {}),
    });
    return {
      items: page.items.map(toVisitRecord),
      ...(page.lastEvaluatedKey ? { lastEvaluatedKey: page.lastEvaluatedKey } : {}),
    };
  }

  async getVisit(planId: string, visitId: string): Promise<PackageVisitRecord | null> {
    const byGsi = await this.getVisitById(visitId);
    if (byGsi) {
      return byGsi.planId === planId ? byGsi : null;
    }
    // Fallback for pre-GSI rows: scan plan visits (bounded).
    const visits = await this.listVisits(planId);
    return visits.find((visit) => visit.visitId === visitId) ?? null;
  }

  /** Access pattern: visit by id via GSI2. */
  async getVisitById(visitId: string): Promise<PackageVisitRecord | null> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :gsi2pk AND GSI2SK = :gsi2sk',
      ExpressionAttributeValues: {
        ':gsi2pk': `VISIT#${visitId}`,
        ':gsi2sk': 'META',
      },
      Limit: 1,
    };
    const items = await this.queryAll<PackageVisitDdbItem>(params);
    return items[0] ? toVisitRecord(items[0]) : null;
  }

  /** Access pattern: vendor scheduled visits for a date via GSI3. */
  async listVendorVisitsForDate(vendorId: string, date: string): Promise<PackageVisitRecord[]> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'GSI3',
      KeyConditionExpression: 'GSI3PK = :gsi3pk AND begins_with(GSI3SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi3pk': `VENDOR#${vendorId}#DATE#${date}`,
        ':prefix': 'VISIT#',
      },
      ScanIndexForward: true,
    };
    const items = await this.queryAll<PackageVisitDdbItem>(params);
    return items.map(toVisitRecord);
  }

  /**
   * Creates visit rows idempotently. Chunks TransactWrite (max 100 items).
   * Conditional put so payment retries do not duplicate visits.
   */
  async createVisitsIfAbsent(visits: PackageVisitRecord[]): Promise<PackageVisitRecord[]> {
    if (visits.length === 0) return visits;
    const existing = await this.listVisits(visits[0].planId);
    if (existing.length > 0) return existing;

    const chunks: PackageVisitRecord[][] = [];
    for (let i = 0; i < visits.length; i += 20) {
      chunks.push(visits.slice(i, i + 20));
    }
    for (const chunk of chunks) {
      await this.transactWrite({
        TransactItems: chunk.map((visit) => ({
          Put: {
            TableName: this.getTableName(),
            Item: toVisitItem(visit),
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        })),
      });
    }
    return visits;
  }

  async saveVisit(next: PackageVisitRecord, expectedVersion: number): Promise<PackageVisitRecord> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: toVisitItem(next),
            ConditionExpression: 'version = :expectedVersion',
            ExpressionAttributeValues: { ':expectedVersion': expectedVersion },
          },
        },
      ],
    });
    return next;
  }

  /**
   * Completes a visit and updates the parent plan progress atomically.
   * Idempotent: if entitlementConsumed is already true, only the visit write is attempted
   * with the caller's expected version (replay returns conflict → caller reloads).
   */
  async completeVisitAndUpdatePlan(input: {
    visit: PackageVisitRecord;
    expectedVisitVersion: number;
    plan: CustomerPlanRecord;
    expectedPlanVersion: number;
  }): Promise<{ visit: PackageVisitRecord; plan: CustomerPlanRecord }> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: toVisitItem(input.visit),
            ConditionExpression: 'version = :expectedVisitVersion AND (attribute_not_exists(entitlementConsumed) OR entitlementConsumed = :false)',
            ExpressionAttributeValues: {
              ':expectedVisitVersion': input.expectedVisitVersion,
              ':false': false,
            },
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: toPlanItem(input.plan),
            ConditionExpression: 'version = :expectedPlanVersion',
            ExpressionAttributeValues: { ':expectedPlanVersion': input.expectedPlanVersion },
          },
        },
      ],
    });
    return { visit: input.visit, plan: input.plan };
  }
}

function planKey(planId: string) {
  return { PK: `CUSTOMER_PLAN#${planId}`, SK: `PLAN#${planId}` };
}

function paymentKey(planId: string, paymentId: string) {
  return { PK: `CUSTOMER_PLAN#${planId}`, SK: `PAYMENT#${paymentId}` };
}

function toPlanItem(record: CustomerPlanRecord): CustomerPlanDdbItem {
  return {
    ...planKey(record.planId),
    GSI1PK: `CUSTOMER#${record.customerId}`,
    GSI1SK: `PLAN#${record.createdAt}#${record.planId}`,
    entityType: 'CustomerPlan',
    ...record,
  };
}

function toPlanRecord(item: CustomerPlanDdbItem): CustomerPlanRecord {
  const { PK: _pk, SK: _sk, GSI1PK: _g1pk, GSI1SK: _g1sk, entityType: _entityType, ...record } = item;
  return record;
}

function toPaymentItem(record: PlanPaymentRecord): PlanPaymentDdbItem {
  return {
    ...paymentKey(record.planId, record.paymentId),
    GSI1PK: `CUSTOMER#${record.customerId}`,
    GSI1SK: `PLAN_PAYMENT#${record.createdAt}#${record.paymentId}`,
    entityType: 'CustomerPlanPayment',
    ...record,
  };
}

function toPaymentRecord(item: PlanPaymentDdbItem): PlanPaymentRecord {
  const { PK: _pk, SK: _sk, GSI1PK: _g1pk, GSI1SK: _g1sk, entityType: _entityType, ...record } = item;
  return record;
}

function visitSk(visit: PackageVisitRecord): string {
  return `VISIT#${String(visit.ordinal).padStart(3, '0')}#${visit.visitId}`;
}

function toVisitItem(record: PackageVisitRecord): PackageVisitDdbItem {
  const date = record.schedule?.date;
  const startTime = record.schedule?.startTime ?? '00:00';
  const item: PackageVisitDdbItem = {
    PK: `CUSTOMER_PLAN#${record.planId}`,
    SK: visitSk(record),
    GSI1PK: `VENDOR#${record.vendorId}`,
    GSI1SK: `VISIT#${date ?? 'UNSCHEDULED'}#${startTime}#${record.visitId}`,
    GSI2PK: `VISIT#${record.visitId}`,
    GSI2SK: 'META',
    entityType: 'PackageVisit',
    ...record,
  };
  if (date) {
    item.GSI3PK = `VENDOR#${record.vendorId}#DATE#${date}`;
    item.GSI3SK = `VISIT#${startTime}#${record.visitId}`;
  }
  return item;
}

function toVisitRecord(item: PackageVisitDdbItem): PackageVisitRecord {
  const {
    PK: _pk,
    SK: _sk,
    GSI1PK: _g1pk,
    GSI1SK: _g1sk,
    GSI2PK: _g2pk,
    GSI2SK: _g2sk,
    GSI3PK: _g3pk,
    GSI3SK: _g3sk,
    entityType: _entityType,
    ...record
  } = item;
  return record;
}

let repository: CustomerPlansRepository;

export function getCustomerPlansRepository() {
  if (!repository) repository = new CustomerPlansRepository();
  return repository;
}
