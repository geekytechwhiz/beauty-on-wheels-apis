import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import {
  CustomerPaymentDdbItem,
  CustomerPaymentIdempotencyDdbItem,
  CustomerPaymentRecord,
} from '../types/payment.types';

export class PaymentsRepository extends BaseRepository {
  getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getPayment(bookingId: string, paymentId: string): Promise<CustomerPaymentRecord | null> {
    const item = await this.get<CustomerPaymentDdbItem>(this.getTableName(), {
      PK: `BOOKING#${bookingId}`,
      SK: `PAYMENT#${paymentId}`,
    });
    return item ? toRecord(item) : null;
  }

  /** All payment attempts for a booking (PK = BOOKING#id, SK begins_with PAYMENT#). */
  async listBookingPayments(bookingId: string): Promise<CustomerPaymentRecord[]> {
    const items = await this.queryAll<CustomerPaymentDdbItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `BOOKING#${bookingId}`, ':prefix': 'PAYMENT#' },
    });
    return items.map(toRecord);
  }

  async getIdempotentPayment(
    customerId: string,
    bookingId: string,
    idempotencyKey: string,
  ): Promise<CustomerPaymentRecord | null> {
    const pointer = await this.get<CustomerPaymentIdempotencyDdbItem>(this.getTableName(), {
      PK: `PAYMENT_IDEMPOTENCY#${customerId}#${bookingId}#${idempotencyKey}`,
      SK: 'PAYMENT_IDEMPOTENCY',
    });
    if (!pointer) return null;
    return this.getPayment(bookingId, pointer.paymentId);
  }

  /**
   * Provider order lookup for Razorpay webhooks when notes omit booking/payment ids.
   * GSI2PK = PAYMENT_PROVIDER#{provider}#{providerOrderId}, GSI2SK = PAYMENT#{paymentId}.
   */
  async getPaymentByProviderOrderId(
    providerOrderId: string,
    provider: CustomerPaymentRecord['provider'] = 'RAZORPAY',
  ): Promise<CustomerPaymentRecord | null> {
    const orderId = providerOrderId.trim();
    if (!orderId) return null;
    const item = await this.queryOne<CustomerPaymentDdbItem>({
      TableName: this.getTableName(),
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': providerOrderPk(provider, orderId),
        ':prefix': 'PAYMENT#',
      },
    });
    return item ? toRecord(item) : null;
  }

  async createPayment(record: CustomerPaymentRecord): Promise<CustomerPaymentRecord> {
    const item = toItem(record);
    const idempotency: CustomerPaymentIdempotencyDdbItem = {
      PK: `PAYMENT_IDEMPOTENCY#${record.customerId}#${record.bookingId}#${record.idempotencyKey}`,
      SK: 'PAYMENT_IDEMPOTENCY',
      paymentId: record.paymentId,
      bookingId: record.bookingId,
      customerId: record.customerId,
      entityType: 'CustomerPaymentIdempotency',
    };
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
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

  async savePayment(record: CustomerPaymentRecord): Promise<CustomerPaymentRecord> {
    await this.put(this.getTableName(), toItem(record));
    return record;
  }
}

function providerOrderPk(provider: CustomerPaymentRecord['provider'], providerOrderId: string): string {
  return `PAYMENT_PROVIDER#${provider}#${providerOrderId}`;
}

function toItem(record: CustomerPaymentRecord): CustomerPaymentDdbItem {
  return {
    PK: `BOOKING#${record.bookingId}`,
    SK: `PAYMENT#${record.paymentId}`,
    GSI1PK: `CUSTOMER#${record.customerId}`,
    GSI1SK: `PAYMENT#${record.createdAt}#${record.paymentId}`,
    ...(record.providerOrderId
      ? {
          GSI2PK: providerOrderPk(record.provider, record.providerOrderId),
          GSI2SK: `PAYMENT#${record.paymentId}`,
        }
      : {}),
    entityType: 'CustomerPayment',
    ...record,
  };
}

function toRecord(item: CustomerPaymentDdbItem): CustomerPaymentRecord {
  return {
    paymentId: item.paymentId,
    bookingId: item.bookingId,
    customerId: item.customerId,
    amountMinor: item.amountMinor,
    providerAmountMinor: item.providerAmountMinor,
    currency: item.currency,
    status: item.status,
    provider: item.provider,
    checkoutToken: item.checkoutToken,
    ...(item.checkoutKeyId ? { checkoutKeyId: item.checkoutKeyId } : {}),
    ...(item.providerOrderId ? { providerOrderId: item.providerOrderId } : {}),
    ...(item.providerPaymentId ? { providerPaymentId: item.providerPaymentId } : {}),
    idempotencyKey: item.idempotencyKey,
    expiresAt: item.expiresAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt,
  };
}

let repository: PaymentsRepository;

export function getPaymentsRepository() {
  if (!repository) repository = new PaymentsRepository();
  return repository;
}
