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
import { BookingsMapper, bookingCommunityId } from '../mappers/bookings.mapper';
import type { BookingConfirmedPayload } from '@api-hub/event-platform';

function communityLookupTransactItems(
  tableName: string,
  booking: Booking,
  createdAt: string,
  previousCommunityId?: string,
): object[] {
  const id = booking.id!;
  const nextCommunityId = bookingCommunityId(booking);
  const items: object[] = [];
  if (previousCommunityId && previousCommunityId !== nextCommunityId) {
    items.push({
      Delete: {
        TableName: tableName,
        Key: {
          PK: `COMMUNITY#${previousCommunityId}`,
          SK: `BOOKING#${id}`,
        },
      },
    });
  }
  if (nextCommunityId) {
    const communityItem = BookingsMapper.toCommunityLookupDdb(booking, createdAt);
    communityItem.updatedAt = new Date().toISOString();
    items.push({
      Put: {
        TableName: tableName,
        Item: communityItem,
      },
    });
  }
  return items;
}

type BookingConfirmedOutbox = {
  eventId: string;
  idempotencyKey: string;
  correlationId: string;
  payload: BookingConfirmedPayload;
};

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
   * Persists the immutable booking snapshot, lookups, audit row and
   * customer-scoped idempotency record. Capacity is reserved atomically by
   * Availability Service before this write; the booking id is its recovery key.
   */
  async createBooking(
    booking: Booking,
    meta: { idempotencyKey: string; requestHash: string },
    contact?: { customerEmail?: string; customerName?: string },
    outbox?: BookingConfirmedOutbox,
  ): Promise<Booking> {
    const id = booking.id!;
    const timestamp = new Date().toISOString();
    const detailsItem = BookingsMapper.toDdbItem(booking, 1, timestamp);
    if (contact?.customerEmail) detailsItem.customerEmail = contact.customerEmail;
    if (contact?.customerName) detailsItem.customerName = contact.customerName;
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

    const transactItems: any[] = [
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
        ...communityLookupTransactItems(this.getTableName(), booking, timestamp),
        {
          Put: {
            TableName: this.getTableName(),
            Item: {
              PK: `IDEMPOTENCY#${booking.customerId}#${meta.idempotencyKey}`,
              SK: 'IDEMPOTENCY',
              bookingId: id,
              customerId: booking.customerId,
              requestHash: meta.requestHash,
              entityType: 'BookingIdempotency',
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
    ];

    if (outbox) {
      transactItems.push({
        Put: {
          TableName: this.getTableName(),
          Item: {
            PK: `BOOKING#${id}`,
            SK: 'OUTBOX#BOOKING_CONFIRMED',
            GSI1PK: 'OUTBOX#BOOKING_CONFIRMED',
            GSI1SK: timestamp,
            entityType: 'BookingConfirmationOutbox',
            bookingId: id,
            ...outbox,
            createdAt: timestamp,
            expiresAt: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      });
    }

    await this.transactWrite({ TransactItems: transactItems });

    return BookingsMapper.toDomain(detailsItem);
  }

  /**
   * Persists a package-plan first job without Availability capacity reservation.
   * Exact visit times remain provider-coordinated; slotId stays empty.
   */
  async createPackageLinkedBooking(booking: Booking): Promise<Booking> {
    const id = booking.id!;
    const timestamp = booking.createdAt || new Date().toISOString();
    const detailsItem = BookingsMapper.toDdbItem(booking, 1, timestamp);
    const customerItem = BookingsMapper.toCustomerLookupDdb(booking, timestamp);
    const vendorItem = BookingsMapper.toVendorLookupDdb(booking, timestamp);
    const auditItem = {
      PK: `BOOKING#${id}`,
      SK: `AUDIT#${timestamp}`,
      GSI1PK: `BOOKING#${id}`,
      GSI1SK: `AUDIT#${timestamp}`,
      bookingId: id,
      action: 'CREATE_PACKAGE_JOB',
      performedBy: 'system',
      timestamp,
      details: `Package plan first job created for plan ${booking.planId}`,
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
        ...communityLookupTransactItems(this.getTableName(), booking, timestamp),
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

  /**
   * Vendor work list via GSI1.
   *
   * Package visits (canonical vendor demand) use GSI1SK = VISIT#{date|UNSCHEDULED}#...
   * One-time VendorBooking lookups use GSI1SK = BOOKING#{date}#...
   * Both share GSI1PK = VENDOR#{vendorId}; this list returns both prefixes so
   * GET /vendors/{vendorId}/bookings matches what operators see in the console.
   */
  async getVendorBookings(vendorId: string): Promise<Booking[]> {
    const gsi1pk = `VENDOR#${vendorId}`;
    const [visitItems, bookingItems] = await Promise.all([
      this.queryVendorGsi1Prefix<Record<string, unknown>>(gsi1pk, 'VISIT#'),
      this.queryVendorGsi1Prefix<BookingLookupDdbItem>(gsi1pk, 'BOOKING#'),
    ]);

    const fromVisits = visitItems.map((item) =>
      BookingsMapper.packageVisitToBookingProjection(item),
    );
    const fromBookings = bookingItems.map((item) => BookingsMapper.toDomain(item));

    // Newest-first: prefer updatedAt/createdAt when present.
    return [...fromVisits, ...fromBookings].sort((a, b) => {
      const aAt = a.updatedAt || a.createdAt || '';
      const bAt = b.updatedAt || b.createdAt || '';
      return bAt.localeCompare(aAt);
    });
  }

  private async queryVendorGsi1Prefix<T>(
    gsi1pk: string,
    prefix: string,
  ): Promise<T[]> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression:
        'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :gsi1skPrefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': gsi1pk,
        ':gsi1skPrefix': prefix,
      },
      ScanIndexForward: false,
    };
    return this.queryAll<T>(params);
  }

  /** Access pattern: community bookings via GSI1 (GSI1PK = COMMUNITY#id, date-sorted GSI1SK). */
  async getCommunityBookings(communityId: string): Promise<Booking[]> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression:
        'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :gsi1skPrefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': `COMMUNITY#${communityId}`,
        ':gsi1skPrefix': 'BOOKING#',
      },
      ScanIndexForward: false,
    };
    const items = await this.queryAll<BookingLookupDdbItem>(params);
    return items.map((item) => BookingsMapper.toDomain(item));
  }

  /**
   * Inclusive civil-date range on vendor booking lookups for operational dashboards.
   * GSI1SK is BOOKING#{serviceDate}#{id} for one-time work.
   * Package-linked rows (planId) are excluded: PackageVisit on GSI3 is canonical,
   * and first-job projections stay on BOOKING#UNSCHEDULED even after bookingDate
   * is synced to the earliest confirmed service civil date.
   */
  async listVendorBookingsForDateRange(
    vendorId: string,
    fromDate: string,
    toDate: string,
  ): Promise<Booking[]> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND GSI1SK BETWEEN :from AND :to',
      FilterExpression: 'attribute_not_exists(planId)',
      ExpressionAttributeValues: {
        ':gsi1pk': `VENDOR#${vendorId}`,
        ':from': `BOOKING#${fromDate}`,
        ':to': `BOOKING#${toDate}#\uffff`,
      },
      ScanIndexForward: true,
    };
    const items = await this.queryAll<BookingLookupDdbItem>(params);
    return items.map((item) => BookingsMapper.toDomain(item));
  }

  /**
   * One schedule timezone sample for timezone resolution when the requested
   * range has no rows. Newest first. Limit 1.
   */
  async sampleVendorBookingTimezone(vendorId: string): Promise<string | undefined> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression:
        'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':gsi1pk': `VENDOR#${vendorId}`,
        ':prefix': 'BOOKING#',
      },
      ScanIndexForward: false,
      Limit: 25,
    };
    const page = await this.queryPage<BookingLookupDdbItem>(params);
    for (const item of page.items) {
      const timezone = item.schedule?.timezone?.trim();
      if (timezone) return timezone;
    }
    return undefined;
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
      ...communityLookupTransactItems(
        this.getTableName(),
        booking,
        original.createdAt,
        bookingCommunityId(BookingsMapper.toDomain(original)),
      ),
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
    outbox?: BookingConfirmedOutbox,
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
    if (original.customerEmail) detailsItem.customerEmail = original.customerEmail;
    if (original.customerName) detailsItem.customerName = original.customerName;

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

    const previousCommunityId = bookingCommunityId(BookingsMapper.toDomain(original));
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
      ...communityLookupTransactItems(
        this.getTableName(),
        updatedBooking,
        original.createdAt,
        previousCommunityId,
      ),
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

    if (outbox) {
      transactItems.push({
        Put: {
          TableName: this.getTableName(),
          Item: {
            PK: `BOOKING#${id}`,
            SK: 'OUTBOX#BOOKING_CONFIRMED',
            GSI1PK: `OUTBOX#BOOKING_CONFIRMED`,
            GSI1SK: timestamp,
            entityType: 'BookingConfirmationOutbox',
            bookingId: id,
            ...outbox,
            createdAt: timestamp,
            // Retain failed-publish evidence briefly; EventBridge delivery is
            // driven by this INSERT's DynamoDB Stream record.
            expiresAt: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      });
    }

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
