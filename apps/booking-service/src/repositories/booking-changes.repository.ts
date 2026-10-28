import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import { BookingsMapper } from '../mappers/bookings.mapper';
import { Booking } from '../types/api-types';
import { BookingDdbItem } from '../types/repository.types';

export interface BookingChangeIdempotencyItem {
  PK: string;
  SK: string;
  bookingId: string;
  changeId: string;
  customerId: string;
  requestHash: string;
  priceDeltaMinor: number;
  entityType: 'BookingChangeIdempotency';
}

export interface BookingChangeRecord {
  changeId: string;
  bookingId: string;
  changeType: 'PROVIDER' | 'SERVICE';
  fromVendorId: string;
  toVendorId: string;
  fromOfferingId?: string;
  toOfferingId: string;
  priceDeltaMinor: number;
  paymentImpact: 'CHARGE' | 'REFUND' | 'NONE';
  /** Allocation key released after commit. */
  releasedAllocationId: string;
  /** Allocation key now backing the booking. */
  allocationId: string;
  createdAt: string;
}

export class BookingChangesRepository extends BaseRepository {
  getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getIdempotency(
    customerId: string,
    bookingId: string,
    idempotencyKey: string,
  ): Promise<BookingChangeIdempotencyItem | null> {
    return this.get<BookingChangeIdempotencyItem>(this.getTableName(), {
      PK: `BOOKING_CHANGE_IDEMPOTENCY#${customerId}#${bookingId}#${idempotencyKey}`,
      SK: 'BOOKING_CHANGE_IDEMPOTENCY',
    });
  }

  /**
   * Atomically swaps the booking snapshot. The original item is only replaced
   * if its version is unchanged; otherwise nothing is written (the caller then
   * releases the newly reserved allocation and the original stays intact).
   * The vendor lookup key changes with the vendor, so the old lookup row is
   * deleted in the same transaction.
   */
  async commitChange(input: {
    original: BookingDdbItem;
    updated: Booking;
    change: BookingChangeRecord;
    customerId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<void> {
    const { original, updated, change } = input;
    const id = original.id;
    const timestamp = change.createdAt;
    const newVersion = original.version + 1;

    const detailsItem = BookingsMapper.toDdbItem(updated, newVersion, original.createdAt);
    detailsItem.updatedAt = timestamp;
    const customerItem = BookingsMapper.toCustomerLookupDdb(updated, original.createdAt);
    customerItem.updatedAt = timestamp;
    const vendorItem = BookingsMapper.toVendorLookupDdb(updated, original.createdAt);
    vendorItem.updatedAt = timestamp;

    const table = this.getTableName();
    const idempotency: BookingChangeIdempotencyItem = {
      PK: `BOOKING_CHANGE_IDEMPOTENCY#${input.customerId}#${id}#${input.idempotencyKey}`,
      SK: 'BOOKING_CHANGE_IDEMPOTENCY',
      bookingId: id,
      changeId: change.changeId,
      customerId: input.customerId,
      requestHash: input.requestHash,
      priceDeltaMinor: change.priceDeltaMinor,
      entityType: 'BookingChangeIdempotency',
    };

    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: table,
            Item: detailsItem,
            ConditionExpression: 'version = :expectedVersion',
            ExpressionAttributeValues: { ':expectedVersion': original.version },
          },
        },
        { Put: { TableName: table, Item: customerItem } },
        ...(original.vendorId !== updated.vendorId
          ? [{ Delete: { TableName: table, Key: { PK: `VENDOR#${original.vendorId}`, SK: `BOOKING#${id}` } } }]
          : []),
        { Put: { TableName: table, Item: vendorItem } },
        {
          Put: {
            TableName: table,
            Item: {
              PK: `BOOKING#${id}`,
              SK: `CHANGE#${timestamp}#${change.changeId}`,
              GSI1PK: `BOOKING#${id}`,
              GSI1SK: `CHANGE#${timestamp}#${change.changeId}`,
              ...change,
              customerId: input.customerId,
              entityType: 'BookingChange',
            },
          },
        },
        {
          Put: {
            TableName: table,
            Item: {
              PK: `BOOKING#${id}`,
              SK: `AUDIT#${timestamp}#${change.changeId}`,
              GSI1PK: `BOOKING#${id}`,
              GSI1SK: `AUDIT#${timestamp}#${change.changeId}`,
              bookingId: id,
              action: `CHANGE_${change.changeType}`,
              performedBy: 'customer',
              timestamp,
              details: `Booking ${change.changeType.toLowerCase()} changed. Price delta ${change.priceDeltaMinor}. Version ${newVersion}`,
              entityType: 'AuditLog',
            },
          },
        },
        {
          Put: {
            TableName: table,
            Item: idempotency,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ],
    });
  }
}

let repository: BookingChangesRepository;

export function getBookingChangesRepository() {
  if (!repository) repository = new BookingChangesRepository();
  return repository;
}
