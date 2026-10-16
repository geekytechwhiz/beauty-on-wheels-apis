import { BaseRepository } from '@api-hub/utils';
import { QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { env } from '../configs/env.config';
import { Booking } from '../types/api-types';
import {
  BookingDdbItem,
  BookingIdempotencyItem,
  BookingLookupDdbItem,
  HoldBookingItem,
} from '../types/repository.types';
import { BookingsMapper } from '../mappers/bookings.mapper';

export class BookingsRepository extends BaseRepository {
  constructor() {
    super();
  }

  // --- Booking Access Patterns ---
  public getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }
  async getBookingById(id: string): Promise<Booking | null> {
    const item = await this.get<BookingDdbItem>(this.getTableName(), {
      PK: `BOOKING#${id}`,
      SK: `BOOKING#${id}`,
    });
    return item ? BookingsMapper.toDomain(item) : null;
  }

  async getBookingDetailsItem(id: string): Promise<BookingDdbItem | null> {
    return this.get<BookingDdbItem>(this.getTableName(), {
      PK: `BOOKING#${id}`,
      SK: `BOOKING#${id}`,
    });
  }

  async getIdempotency(
    customerId: string,
    idempotencyKey: string,
  ): Promise<BookingIdempotencyItem | null> {
    return this.get<BookingIdempotencyItem>(this.getTableName(), {
      PK: `IDEMPOTENCY#${customerId}#${idempotencyKey}`,
      SK: 'IDEMPOTENCY',
    });
  }

  async getHoldBooking(holdId: string): Promise<HoldBookingItem | null> {
    return this.get<HoldBookingItem>(this.getTableName(), {
      PK: `HOLD_BOOKING#${holdId}`,
      SK: 'HOLD_BOOKING',
    });
  }

  /**
   * Persists the booking, lookups, audit row, idempotency record, and a hold
   * lock. Slot capacity stays in Availability Service; this lock only stops a
   * second booking id from being created for the same hold.
   */
  async createBooking(
    booking: Booking,
    meta: { idempotencyKey: string; requestHash: string },
  ): Promise<Booking> {
    const id = booking.id!;
    const timestamp = new Date().toISOString();
    const detailsItem = BookingsMapper.toDdbItem(booking, 1, timestamp);
    const customerItem = BookingsMapper.toCustomerLookupDdb(booking, timestamp);
    const vendorItem = BookingsMapper.toVendorLookupDdb(booking, timestamp);

    const auditItem = {
      PK: `BOOKING#${id}`,
      SK: `AUDIT#${timestamp}`,
      GSI1PK: `BOOKING#${id}`,
      GSI1SK: `AUDIT#${timestamp}`,
      bookingId: id,
      action: 'CREATE',
      performedBy: 'customer',
      timestamp,
      details: 'Booking created',
      entityType: 'AuditLog',
    };

    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: detailsItem,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: customerItem,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: vendorItem,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: {
              PK: `IDEMPOTENCY#${booking.customerId}#${meta.idempotencyKey}`,
              SK: 'IDEMPOTENCY',
              bookingId: id,
              customerId: booking.customerId,
              holdId: booking.holdId,
              requestHash: meta.requestHash,
              entityType: 'BookingIdempotency',
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: {
              PK: `HOLD_BOOKING#${booking.holdId}`,
              SK: 'HOLD_BOOKING',
              bookingId: id,
              customerId: booking.customerId,
              holdId: booking.holdId,
              entityType: 'HoldBooking',
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: auditItem,
          },
        },
      ],
    });

    return BookingsMapper.toDomain(detailsItem);
  }

  /** Access pattern: customer bookings via GSI1 (GSI1PK = CUSTOMER#id, date-sorted GSI1SK). */
  async getCustomerBookings(customerId: string): Promise<Booking[]> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression:
        'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :gsi1skPrefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': `CUSTOMER#${customerId}`,
        ':gsi1skPrefix': 'BOOKING#',
      },
      ScanIndexForward: false,
    };
    const items = await this.queryAll<BookingLookupDdbItem>(params);
    return items.map((item) => BookingsMapper.toDomain(item));
  }

  /** Access pattern: vendor bookings via GSI1 (GSI1PK = VENDOR#id, date-sorted GSI1SK). */
  async getVendorBookings(vendorId: string): Promise<Booking[]> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression:
        'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :gsi1skPrefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': `VENDOR#${vendorId}`,
        ':gsi1skPrefix': 'BOOKING#',
      },
      ScanIndexForward: false,
    };
    const items = await this.queryAll<BookingLookupDdbItem>(params);
    return items.map((item) => BookingsMapper.toDomain(item));
  }

  /** Access pattern: global booking list via GSI1 (GSI1PK = BOOKING_LIST). */
  async listAllBookings(): Promise<Booking[]> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression:
        'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :gsi1skPrefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': 'BOOKING_LIST',
        ':gsi1skPrefix': 'BOOKING#',
      },
      ScanIndexForward: false,
    };
    const items = await this.queryAll<BookingDdbItem>(params);
    return items.map((item) => BookingsMapper.toDomain(item));
  }

  async updateBooking(
    booking: Booking,
    original: BookingDdbItem,
  ): Promise<void> {
    const id = booking.id!;
    const timestamp = new Date().toISOString();
    const newVersion = original.version + 1;
    const detailsItem = BookingsMapper.toDdbItem(
      booking,
      newVersion,
      original.createdAt,
    );
    detailsItem.updatedAt = timestamp;

    const customerItem = BookingsMapper.toCustomerLookupDdb(
      booking,
      original.createdAt,
    );
    customerItem.updatedAt = timestamp;

    const vendorItem = BookingsMapper.toVendorLookupDdb(
      booking,
      original.createdAt,
    );
    vendorItem.updatedAt = timestamp;

    const transactItems: any[] = [
      {
        Put: {
          TableName: this.getTableName(),
          Item: detailsItem,
          ConditionExpression: 'version = :expectedVersion',
          ExpressionAttributeValues: {
            ':expectedVersion': original.version,
          },
        },
      },
      {
        Put: {
          TableName: this.getTableName(),
          Item: customerItem,
        },
      },
      {
        Put: {
          TableName: this.getTableName(),
          Item: vendorItem,
        },
      },
      {
        Put: {
          TableName: this.getTableName(),
          Item: {
            PK: `BOOKING#${id}`,
            SK: `AUDIT#${timestamp}`,
            GSI1PK: `BOOKING#${id}`,
            GSI1SK: `AUDIT#${timestamp}`,
            bookingId: id,
            action: 'UPDATE',
            performedBy: 'customer',
            timestamp,
            details: `Booking rescheduled/updated. Version ${newVersion}`,
            entityType: 'AuditLog',
          },
        },
      },
    ];

    await this.transactWrite({ TransactItems: transactItems });
  }

  async updateBookingStatus(
    status: Booking['bookingStatus'],
    original: BookingDdbItem,
    paymentStatus: Booking['paymentStatus'] = original.paymentStatus,
  ): Promise<void> {
    const id = original.id;
    const timestamp = new Date().toISOString();
    const newVersion = original.version + 1;

    const updatedBooking: Booking = {
      ...BookingsMapper.toDomain(original),
      paymentStatus,
      bookingStatus: status,
    };

    const detailsItem = BookingsMapper.toDdbItem(
      updatedBooking,
      newVersion,
      original.createdAt,
    );
    detailsItem.updatedAt = timestamp;

    const customerItem = BookingsMapper.toCustomerLookupDdb(
      updatedBooking,
      original.createdAt,
    );
    customerItem.updatedAt = timestamp;

    const vendorItem = BookingsMapper.toVendorLookupDdb(
      updatedBooking,
      original.createdAt,
    );
    vendorItem.updatedAt = timestamp;

    const transactItems: any[] = [
      {
        Put: {
          TableName: this.getTableName(),
          Item: detailsItem,
          ConditionExpression: 'version = :expectedVersion',
          ExpressionAttributeValues: {
            ':expectedVersion': original.version,
          },
        },
      },
      {
        Put: {
          TableName: this.getTableName(),
          Item: customerItem,
        },
      },
      {
        Put: {
          TableName: this.getTableName(),
          Item: vendorItem,
        },
      },
      {
        Put: {
          TableName: this.getTableName(),
          Item: {
            PK: `BOOKING#${id}`,
            SK: `AUDIT#${timestamp}`,
            GSI1PK: `BOOKING#${id}`,
            GSI1SK: `AUDIT#${timestamp}`,
            bookingId: id,
            action: `STATUS_${status}`,
            performedBy: 'system',
            timestamp,
            details: `Status updated from ${original.bookingStatus} to ${status}. Version ${newVersion}`,
            entityType: 'AuditLog',
          },
        },
      },
    ];

    await this.transactWrite({ TransactItems: transactItems });
  }

  async cancelBooking(original: BookingDdbItem): Promise<void> {
    const id = original.id;
    const timestamp = new Date().toISOString();
    const newVersion = original.version + 1;

    const updatedBooking: Booking = {
      ...BookingsMapper.toDomain(original),
      bookingStatus: 'CANCELLED',
    };

    const detailsItem = BookingsMapper.toDdbItem(
      updatedBooking,
      newVersion,
      original.createdAt,
    );
    detailsItem.updatedAt = timestamp;

    const customerItem = BookingsMapper.toCustomerLookupDdb(
      updatedBooking,
      original.createdAt,
    );
    customerItem.updatedAt = timestamp;

    const vendorItem = BookingsMapper.toVendorLookupDdb(
      updatedBooking,
      original.createdAt,
    );
    vendorItem.updatedAt = timestamp;

    const transactItems: any[] = [
      {
        Put: {
          TableName: this.getTableName(),
          Item: detailsItem,
          ConditionExpression: 'version = :expectedVersion',
          ExpressionAttributeValues: {
            ':expectedVersion': original.version,
          },
        },
      },
      {
        Put: {
          TableName: this.getTableName(),
          Item: customerItem,
        },
      },
      {
        Put: {
          TableName: this.getTableName(),
          Item: vendorItem,
        },
      },
      {
        Delete: {
          TableName: this.getTableName(),
          Key: {
            PK: `SLOT_RESERVATION#${original.vendorId}#${original.bookingDate}#${original.slotId}`,
            SK: `SLOT_RESERVATION`,
          },
        },
      },
      {
        Put: {
          TableName: this.getTableName(),
          Item: {
            PK: `BOOKING#${id}`,
            SK: `AUDIT#${timestamp}`,
            GSI1PK: `BOOKING#${id}`,
            GSI1SK: `AUDIT#${timestamp}`,
            bookingId: id,
            action: 'CANCEL',
            performedBy: 'customer',
            timestamp,
            details: `Booking cancelled. Version ${newVersion}`,
            entityType: 'AuditLog',
          },
        },
      },
    ];

    await this.transactWrite({ TransactItems: transactItems });
  }

  async bookingExists(id: string): Promise<boolean> {
    const item = await this.getBookingById(id);
    return item !== null;
  }
}

let repository: BookingsRepository;

export function getBookingsRepository() {
  if (!repository) {
    repository = new BookingsRepository();
  }
  return repository;
}
