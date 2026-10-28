import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import {
  BOOKING_READINESS_SK,
  type BookingReadinessRecord,
  type ReadinessSlot,
} from '../domain/booking-readiness';
import { VendorKeyBuilder } from '../utils/constants/vendor-key-builder';

type ReadinessItem = BookingReadinessRecord & {
  PK: string;
  SK: string;
  entityType: 'BookingReadiness';
};

export class BookingReadinessRepository extends BaseRepository {
  private table() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async find(vendorId: string): Promise<BookingReadinessRecord | null> {
    const item = await super.get<ReadinessItem>(this.table(), {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: BOOKING_READINESS_SK,
    }, { consistent: true });
    if (!item || item.entityType !== 'BookingReadiness') return null;
    const { PK: _pk, SK: _sk, entityType: _type, ...record } = item;
    return record;
  }

  /**
   * Whole-item replace guarded by the revision the caller observed.
   * A source version guard rejects a stale fact that lost the revision race.
   */
  async save(
    record: BookingReadinessRecord,
    expectedRevision: number | null,
    sourceVersion?: { slot: ReadinessSlot; version: number },
  ): Promise<void> {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const conditions = [
      expectedRevision === null
        ? 'attribute_not_exists(PK)'
        : '#revision = :seen',
    ];
    if (expectedRevision !== null) {
      names['#revision'] = 'projectionRevision';
      values[':seen'] = expectedRevision;
    }
    if (sourceVersion) {
      names['#sources'] = sourceVersion.slot;
      names['#version'] = 'aggregateVersion';
      values[':version'] = sourceVersion.version;
      conditions.push('(attribute_not_exists(#sources.#version) OR #sources.#version < :version)');
    }
    await this.transactWrite({
      TransactItems: [{
        Put: {
          TableName: this.table(),
          Item: {
            ...record,
            PK: VendorKeyBuilder.vendorPk(record.vendorId),
            SK: BOOKING_READINESS_SK,
            entityType: 'BookingReadiness',
          } satisfies ReadinessItem,
          ConditionExpression: conditions.join(' AND '),
          ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
          ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
        },
      }],
    });
  }
}

let repository: BookingReadinessRepository | undefined;
export function getBookingReadinessRepository() {
  if (!repository) repository = new BookingReadinessRepository();
  return repository;
}
