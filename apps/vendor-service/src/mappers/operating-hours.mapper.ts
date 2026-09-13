import {
  DayOfWeek,
  OperatingHours,
  OperatingHoursRequest,
} from '../types/api-types';
import {
  OperatingHoursEntry,
  VendorOperatingHoursDdbItem,
} from '../types/repository.types';
import {
  VENDOR_OPERATING_HOURS_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';

const DAY_ORDER: Record<DayOfWeek, number> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
};

export class OperatingHoursMapper {
  static toDomain(
    item: VendorOperatingHoursDdbItem,
  ): OperatingHours[] {
    return [...item.operatingHours]
      .sort((a, b) => DAY_ORDER[a.dayOfWeek] - DAY_ORDER[b.dayOfWeek])
      .map((entry) => OperatingHoursMapper.toDomainEntry(item.vendorId, entry));
  }

  static empty(): OperatingHours[] {
    return [];
  }

  static toDdbItem(
    operatingHours: OperatingHoursRequest[],
    vendorId: string,
    options?: { createdAt?: string },
  ): VendorOperatingHoursDdbItem {
    const timestamp = new Date().toISOString();
    const createdAt = options?.createdAt || timestamp;

    return {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.operatingHoursSk(),
      vendorId,
      operatingHours: operatingHours.map((entry) =>
        OperatingHoursMapper.toEntry(entry),
      ),
      createdAt,
      updatedAt: timestamp,
      entityType: VENDOR_OPERATING_HOURS_ENTITY_TYPE,
    };
  }

  private static toDomainEntry(
    vendorId: string,
    entry: OperatingHoursEntry,
  ): OperatingHours {
    return {
      vendorId,
      dayOfWeek: entry.dayOfWeek,
      closed: entry.closed,
      ...(entry.openTime ? { openTime: entry.openTime } : {}),
      ...(entry.closeTime ? { closeTime: entry.closeTime } : {}),
    };
  }

  private static toEntry(entry: OperatingHoursRequest): OperatingHoursEntry {
    if (entry.closed) {
      return {
        dayOfWeek: entry.dayOfWeek,
        closed: true,
      };
    }

    return {
      dayOfWeek: entry.dayOfWeek,
      closed: false,
      openTime: entry.openTime,
      closeTime: entry.closeTime,
    };
  }
}
