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

/**
 * Key layout (shared booking table):
 *   plan            PK CUSTOMER_PLAN#{planId}  SK PLAN#{planId}          GSI1 CUSTOMER#{customerId} / PLAN#{createdAt}#{planId}
 *   plan payment    PK CUSTOMER_PLAN#{planId}  SK PAYMENT#{paymentId}    GSI1 CUSTOMER#{customerId} / PLAN_PAYMENT#{createdAt}#{paymentId}
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

let repository: CustomerPlansRepository;

export function getCustomerPlansRepository() {
  if (!repository) repository = new CustomerPlansRepository();
  return repository;
}
