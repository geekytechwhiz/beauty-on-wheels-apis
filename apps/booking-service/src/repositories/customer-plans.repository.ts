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
import { addCalendarDays } from '../domain/vendor-package-visits';
import { visitCoversDate, visitIndexDate } from '../domain/package-visit';
import {
  PackageVisitDdbItem,
  PackageVisitRecord,
} from '../types/package-visit.types';

/** Max inclusive commitment window days (manager bulk schedule). */
export const MAX_RANGE_SCHEDULE_DAYS = 7;

/**
 * Key layout (shared booking table):
 *   plan            PK CUSTOMER_PLAN#{planId}  SK PLAN#{planId}          GSI1 CUSTOMER#{customerId} / PLAN#{createdAt}#{planId}
 *   plan payment    PK CUSTOMER_PLAN#{planId}  SK PAYMENT#{paymentId}    GSI1 CUSTOMER#{customerId} / PLAN_PAYMENT#{createdAt}#{paymentId}
 *   package visit   PK CUSTOMER_PLAN#{planId}  SK VISIT#{ordinal:03d}#{visitId}
 *                   GSI1 VENDOR#{vendorId} / VISIT#{date|UNSCHEDULED}#{startTime|0000}#{visitId}
 *                   GSI2 VISIT#{visitId} / META  (visit lookup only — not vendor work)
 *                   GSI3 (scheduled only) VENDOR#{vendorId}#DATE#{date} / VISIT#{startTime}#{visitId}
 *                     exact slot → schedule.date; range commitment → scheduleStartDate (primary)
 *                     listVendorVisitsForDate also overlaps GSI1 lookback for range coverage
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

  /** Payment attempts are colocated with the plan, so this is a bounded strongly-consistent read. */
  async listPayments(planId: string): Promise<PlanPaymentRecord[]> {
    const items = await this.queryAll<PlanPaymentDdbItem>({
      TableName: this.getTableName(),
      ConsistentRead: true,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `CUSTOMER_PLAN#${planId}`,
        ':prefix': 'PAYMENT#',
      },
      ScanIndexForward: false,
    });
    return items.map(toPaymentRecord);
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

  /**
   * Vendor scheduled visits operationally expected on a civil date.
   * GSI3 holds exact-slot rows and range rows indexed under scheduleStartDate.
   * A bounded GSI1 lookback (max commitment window − 1) finds range commitments
   * whose start is earlier than `date` but whose end still covers it.
   */
  async listVendorVisitsForDate(vendorId: string, date: string): Promise<PackageVisitRecord[]> {
    const gsi3Params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'GSI3',
      KeyConditionExpression: 'GSI3PK = :gsi3pk AND begins_with(GSI3SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi3pk': `VENDOR#${vendorId}#DATE#${date}`,
        ':prefix': 'VISIT#',
      },
      ScanIndexForward: true,
    };
    const fromGsi3 = (await this.queryAll<PackageVisitDdbItem>(gsi3Params)).map(toVisitRecord);

    const lookbackStart = addCalendarDays(date, -(MAX_RANGE_SCHEDULE_DAYS - 1));
    const gsi1Params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :from AND :to',
      ExpressionAttributeValues: {
        ':pk': `VENDOR#${vendorId}`,
        ':from': `VISIT#${lookbackStart}`,
        ':to': `VISIT#${date}#\uffff`,
      },
      ScanIndexForward: true,
    };
    const fromGsi1 = (await this.queryAll<PackageVisitDdbItem>(gsi1Params))
      .map(toVisitRecord)
      .filter((visit) => visitCoversDate(visit, date));

    return [...new Map([...fromGsi3, ...fromGsi1].map((visit) => [visit.visitId, visit])).values()];
  }

  /**
   * One schedule timezone sample for operations summary when the requested range
   * has no dated rows. Uses a civil-date GSI1 range so VISIT#UNSCHEDULED#... keys
   * (lexically after YYYY-MM-DD) cannot crowd out scheduled samples.
   */
  async sampleVendorVisitTimezone(vendorId: string): Promise<string | undefined> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :from AND :to',
      ExpressionAttributeValues: {
        ':pk': `VENDOR#${vendorId}`,
        ':from': 'VISIT#1970-01-01',
        ':to': 'VISIT#9999-12-31#\uffff',
      },
      ScanIndexForward: false,
      Limit: 25,
    };
    const page = await this.queryPage<PackageVisitDdbItem>(params);
    for (const item of page.items) {
      if (item.status === 'UNSCHEDULED') continue;
      if (!item.schedule?.date && !item.scheduleStartDate) continue;
      const timezone = item.schedule?.timezone?.trim() || item.visitWindowSnapshot?.timezone?.trim();
      if (timezone) return timezone;
    }
    return undefined;
  }

  /**
   * Vendor package-visit work queue.
   *
   * Access patterns:
   * - No dates → GSI1 `VENDOR#{vendorId}` / begins_with `VISIT#` (scheduled + UNSCHEDULED).
   *   Optional status=UNSCHEDULED narrows to `VISIT#UNSCHEDULED#`.
   * - Single day → GSI3 `VENDOR#{vendorId}#DATE#{date}` (scheduled for that civil day).
   * - Inclusive range → GSI1 BETWEEN dated `VISIT#` keys (UNSCHEDULED is outside the range).
   */
  async queryVendorPackageVisits(input: {
    vendorId: string;
    fromDate?: string;
    toDate?: string;
    status?: string;
    limit: number;
    exclusiveStartKey?: Record<string, unknown>;
  }): Promise<{ items: PackageVisitPageRow[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const dateScoped = Boolean(input.fromDate && input.toDate);
    const singleDay = dateScoped && input.fromDate === input.toDate;
    const unscheduledOnly = !dateScoped && input.status === 'UNSCHEDULED';

    let params: QueryCommandInput;
    let resume: (item: PackageVisitDdbItem) => Record<string, unknown>;

    if (!dateScoped) {
      params = {
        TableName: this.getTableName(),
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `VENDOR#${input.vendorId}`,
          ':prefix': unscheduledOnly ? 'VISIT#UNSCHEDULED#' : 'VISIT#',
        },
        ScanIndexForward: true,
        Limit: input.limit,
        ...(input.exclusiveStartKey ? { ExclusiveStartKey: input.exclusiveStartKey } : {}),
      };
      resume = gsi1ResumeKey;
    } else if (singleDay) {
      params = {
        TableName: this.getTableName(),
        IndexName: 'GSI3',
        KeyConditionExpression: 'GSI3PK = :pk AND begins_with(GSI3SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `VENDOR#${input.vendorId}#DATE#${input.fromDate}`,
          ':prefix': 'VISIT#',
        },
        ScanIndexForward: true,
        Limit: input.limit,
        ...(input.exclusiveStartKey ? { ExclusiveStartKey: input.exclusiveStartKey } : {}),
      };
      resume = gsi3ResumeKey;
    } else {
      // Expand start lookback so range commitments that began before fromDate
      // but still overlap the requested window remain visible.
      const rangeFrom = addCalendarDays(input.fromDate!, -(MAX_RANGE_SCHEDULE_DAYS - 1));
      params = {
        TableName: this.getTableName(),
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': `VENDOR#${input.vendorId}`,
          ':from': `VISIT#${rangeFrom}`,
          ':to': `VISIT#${input.toDate}#\uffff`,
        },
        ScanIndexForward: true,
        Limit: input.limit,
        ...(input.exclusiveStartKey ? { ExclusiveStartKey: input.exclusiveStartKey } : {}),
      };
      resume = gsi1ResumeKey;
    }

    const page = await this.queryPage<PackageVisitDdbItem>(params);
    return {
      items: page.items.map((item) => ({
        record: toVisitRecord(item),
        resumeKey: resume(item),
      })),
      ...(page.lastEvaluatedKey ? { lastEvaluatedKey: page.lastEvaluatedKey } : {}),
    };
  }

  /** @deprecated Prefer queryVendorPackageVisits — kept for call-site clarity during migrate. */
  async queryVendorScheduledVisits(input: {
    vendorId: string;
    fromDate: string;
    toDate: string;
    limit: number;
    exclusiveStartKey?: Record<string, unknown>;
  }): Promise<{ items: PackageVisitPageRow[]; lastEvaluatedKey?: Record<string, unknown> }> {
    return this.queryVendorPackageVisits(input);
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
   * Writes every visit in one TransactWrite. A version or status mismatch fails the whole group.
   * Callers keep the batch at or below the DynamoDB transaction item limit.
   * Requires the persisted row to already be SCHEDULED (crew-only updates).
   */
  async saveVisits(updates: Array<{ next: PackageVisitRecord; expectedVersion: number }>): Promise<void> {
    if (updates.length === 0) return;
    await this.transactWrite({
      TransactItems: updates.map((update) => ({
        Put: {
          TableName: this.getTableName(),
          Item: toVisitItem(update.next),
          ConditionExpression: 'version = :expectedVersion AND #status = :scheduled',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':expectedVersion': update.expectedVersion,
            ':scheduled': 'SCHEDULED',
          },
        },
      })),
    });
  }

  /**
   * Bulk schedule-and-assign: UNSCHEDULED → SCHEDULED or reschedule while SCHEDULED.
   * Optional idempotency row is written in the same transaction.
   */
  async saveScheduleAssignments(input: {
    updates: Array<{ next: PackageVisitRecord; expectedVersion: number; fromStatus: 'UNSCHEDULED' | 'SCHEDULED' }>;
    idempotency?: VisitScheduleIdempotencyItem;
  }): Promise<void> {
    if (input.updates.length === 0 && !input.idempotency) return;
    const visitItems = input.updates.map((update) => ({
      Put: {
        TableName: this.getTableName(),
        Item: toVisitItem(update.next),
        ConditionExpression: 'version = :expectedVersion AND #status = :fromStatus',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':expectedVersion': update.expectedVersion,
          ':fromStatus': update.fromStatus,
        },
      },
    }));
    const idempotencyItems = input.idempotency
      ? [{
        Put: {
          TableName: this.getTableName(),
          Item: input.idempotency,
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      }]
      : [];
    await this.transactWrite({
      TransactItems: [...visitItems, ...idempotencyItems],
    });
  }

  async getScheduleIdempotency(
    vendorId: string,
    idempotencyKey: string,
  ): Promise<VisitScheduleIdempotencyItem | null> {
    return this.get<VisitScheduleIdempotencyItem>(this.getTableName(), {
      PK: `VISIT_SCHEDULE_IDEMPOTENCY#${vendorId}#${idempotencyKey}`,
      SK: 'IDEMPOTENCY',
    });
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

  /**
   * Scheduled package visits for one civil date on GSI4.
   * communityId and visitWindowId are key prefixes. Vendor and status stay filters.
   */
  async queryOpsSchedule(input: {
    date: string;
    communityId?: string;
    visitWindowId?: string;
    limit: number;
    exclusiveStartKey?: Record<string, unknown>;
  }): Promise<{ items: PackageVisitPageRow[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const prefix = input.communityId
      ? `${input.communityId}#${input.visitWindowId ? `${input.visitWindowId}#` : ''}`
      : undefined;
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'GSI4',
      KeyConditionExpression: prefix
        ? 'GSI4PK = :pk AND begins_with(GSI4SK, :prefix)'
        : 'GSI4PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `OPS_SCHEDULE#${input.date}`,
        ...(prefix ? { ':prefix': prefix } : {}),
      },
      Limit: input.limit,
      ...(input.exclusiveStartKey ? { ExclusiveStartKey: input.exclusiveStartKey } : {}),
      ScanIndexForward: true,
    };
    const page = await this.queryPage<PackageVisitDdbItem>(params);
    return {
      items: page.items.map((item) => ({ record: toVisitRecord(item), resumeKey: gsi4ResumeKey(item) })),
      lastEvaluatedKey: page.lastEvaluatedKey,
    };
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
  const indexDate = visitIndexDate(record);
  const startTime = record.schedule?.startTime ?? '00:00';
  const scheduled = Boolean(indexDate) && record.status !== 'UNSCHEDULED';
  const item: PackageVisitDdbItem = {
    PK: `CUSTOMER_PLAN#${record.planId}`,
    SK: visitSk(record),
    GSI1PK: `VENDOR#${record.vendorId}`,
    GSI1SK: `VISIT#${scheduled ? indexDate : 'UNSCHEDULED'}#${startTime}#${record.visitId}`,
    GSI2PK: `VISIT#${record.visitId}`,
    GSI2SK: 'META',
    entityType: 'PackageVisit',
    ...record,
  };
  // GSI3 is the vendor/date work index for home-summary and day lists.
  // Range commitments are indexed under scheduleStartDate; readers overlap-query
  // via GSI1 lookback so every day in the window remains discoverable.
  // Omit attributes on Put so DynamoDB drops stale GSI3 entries (e.g. cancel).
  if (scheduled && indexDate) {
    item.GSI3PK = `VENDOR#${record.vendorId}#DATE#${indexDate}`;
    item.GSI3SK = `VISIT#${startTime}#${record.visitId}`;
  }
  const opsIndex = opsScheduleIndex(record);
  if (opsIndex) {
    item.GSI4PK = opsIndex.GSI4PK;
    item.GSI4SK = opsIndex.GSI4SK;
  }
  return item;
}

/** Cross-vendor dispatch and demand. One partition per civil date (start of commitment). */
export function opsScheduleIndex(
  record: Pick<
    PackageVisitRecord,
    'schedule' | 'scheduleStartDate' | 'status' | 'communityId' | 'visitWindowId' | 'vendorId' | 'visitId'
  >,
): { GSI4PK: string; GSI4SK: string } | undefined {
  const date = visitIndexDate(record as PackageVisitRecord);
  if (!date || record.status === 'UNSCHEDULED') return undefined;
  const communityId = record.communityId?.trim() || '_';
  const visitWindowId = record.visitWindowId?.trim() || '_';
  const startTime = record.schedule?.startTime ?? '00:00';
  return {
    GSI4PK: `OPS_SCHEDULE#${date}`,
    GSI4SK: `${communityId}#${visitWindowId}#${record.vendorId}#${record.status}#${startTime}#${record.visitId}`,
  };
}

export interface VisitScheduleIdempotencyItem {
  PK: string;
  SK: string;
  vendorId: string;
  idempotencyKey: string;
  requestHash: string;
  result: Record<string, unknown>;
  entityType: 'VisitScheduleIdempotency';
  createdAt: string;
}

export function buildScheduleIdempotencyItem(input: {
  vendorId: string;
  idempotencyKey: string;
  requestHash: string;
  result: Record<string, unknown>;
  createdAt: string;
}): VisitScheduleIdempotencyItem {
  return {
    PK: `VISIT_SCHEDULE_IDEMPOTENCY#${input.vendorId}#${input.idempotencyKey}`,
    SK: 'IDEMPOTENCY',
    vendorId: input.vendorId,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    result: input.result,
    entityType: 'VisitScheduleIdempotency',
    createdAt: input.createdAt,
  };
}

export interface PackageVisitPageRow {
  record: PackageVisitRecord;
  resumeKey: Record<string, unknown>;
}

function gsi1ResumeKey(item: PackageVisitDdbItem): Record<string, unknown> {
  return {
    PK: item.PK,
    SK: item.SK,
    GSI1PK: item.GSI1PK,
    GSI1SK: item.GSI1SK,
  };
}

function gsi3ResumeKey(item: PackageVisitDdbItem): Record<string, unknown> {
  return {
    PK: item.PK,
    SK: item.SK,
    GSI3PK: item.GSI3PK,
    GSI3SK: item.GSI3SK,
  };
}

function gsi4ResumeKey(item: PackageVisitDdbItem): Record<string, unknown> {
  return {
    PK: item.PK,
    SK: item.SK,
    GSI4PK: item.GSI4PK,
    GSI4SK: item.GSI4SK,
  };
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
    GSI4PK: _g4pk,
    GSI4SK: _g4sk,
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
