import { LambdaRequest } from '@api-hub/utils';
import {
  ConditionalWriteConflictError,
  NotFoundError,
  ValidationError,
  isConditionalWriteConflictAtIndex,
} from '@api-hub/utils';
import { createLogger, createChildLogger } from '@api-hub/observability';

import {
  OperatingHoursRepository,
  getOperatingHoursRepository,
} from '../repositories/operating-hours.repository';
import {
  VendorsRepository,
  getVendorsRepository,
} from '../repositories/vendors.repository';
import { OperatingHoursMapper } from '../mappers/operating-hours.mapper';
import {
  DayOfWeek,
  OperatingHours,
  OperatingHoursRequest,
  UpdateVendorOperatingHoursRequest,
} from '../types/api-types';
import {
  assertVendorAccess,
  getAuthenticatedUserId,
  getVendorId,
} from '../utils/helpers';

const baseLogger = createLogger({
  service: 'operating-hours-service',
  redactPII: true,
});

const DAY_ORDER: Record<DayOfWeek, number> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
};

export class OperatingHoursService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'OperatingHoursService',
  });

  constructor(
    private readonly repository: OperatingHoursRepository = getOperatingHoursRepository(),
    private readonly vendorsRepository: VendorsRepository = getVendorsRepository(),
  ) {}

  private async requireAccessibleVendor(request: LambdaRequest, vendorId: string) {
    const item = await this.vendorsRepository.getVendorById(vendorId);
    if (!item) {
      throw new NotFoundError('Vendor not found');
    }
    assertVendorAccess(request, item);
    return item;
  }

  async getvendoroperatinghours(
    request: LambdaRequest,
  ): Promise<{ data: OperatingHours[] }> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);

    this.logger.info({
      event: 'getvendoroperatinghours_start',
      userId,
      vendorId,
    });

    try {
      await this.requireAccessibleVendor(request, vendorId);
      const item = await this.repository.getOperatingHours(vendorId);
      const data = item
        ? OperatingHoursMapper.toDomain(item)
        : OperatingHoursMapper.empty();

      this.logger.info({
        event: 'getvendoroperatinghours_success',
        userId,
        vendorId,
        count: data.length,
      });

      return { data };
    } catch (error: any) {
      this.logger.error({
        event: 'getvendoroperatinghours_failed',
        userId,
        vendorId,
        error: error.message,
      });
      throw error;
    }
  }

  async updatevendoroperatinghours(
    request: LambdaRequest,
  ): Promise<{ data: OperatingHours[] }> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);
    const body = request.body as UpdateVendorOperatingHoursRequest;

    this.logger.info({
      event: 'updatevendoroperatinghours_start',
      userId,
      vendorId,
    });

    try {
      await this.requireAccessibleVendor(request, vendorId);
      const schedule = this.normalizeSchedule(body.operatingHours);
      const existing = await this.repository.getOperatingHours(vendorId);
      const ddbItem = OperatingHoursMapper.toDdbItem(schedule, vendorId, {
        createdAt: existing?.createdAt,
      });

      try {
        await this.repository.putOperatingHours(ddbItem);
      } catch (err) {
        if (isConditionalWriteConflictAtIndex(err, 0)) {
          throw new NotFoundError('Vendor not found');
        }
        if (err instanceof ConditionalWriteConflictError) {
          throw new NotFoundError('Vendor not found');
        }
        throw err;
      }

      const data = OperatingHoursMapper.toDomain(ddbItem);

      this.logger.info({
        event: 'updatevendoroperatinghours_success',
        userId,
        vendorId,
        count: data.length,
      });

      return { data };
    } catch (error: any) {
      this.logger.error({
        event: 'updatevendoroperatinghours_failed',
        userId,
        vendorId,
        error: error.message,
      });
      throw error;
    }
  }

  private normalizeSchedule(
    hours: OperatingHoursRequest[],
  ): OperatingHoursRequest[] {
    const seen = new Set<DayOfWeek>();
    const normalized: OperatingHoursRequest[] = [];

    for (const entry of hours) {
      if (seen.has(entry.dayOfWeek)) {
        throw new ValidationError(
          `Duplicate operating hours for ${entry.dayOfWeek}`,
        );
      }
      seen.add(entry.dayOfWeek);

      if (entry.closed) {
        normalized.push({
          dayOfWeek: entry.dayOfWeek,
          closed: true,
        });
        continue;
      }

      if (!entry.openTime || !entry.closeTime) {
        throw new ValidationError(
          `openTime and closeTime are required when ${entry.dayOfWeek} is not closed`,
        );
      }

      if (toMinutes(entry.closeTime) <= toMinutes(entry.openTime)) {
        throw new ValidationError(
          `closeTime must be after openTime for ${entry.dayOfWeek}`,
        );
      }

      normalized.push({
        dayOfWeek: entry.dayOfWeek,
        closed: false,
        openTime: entry.openTime,
        closeTime: entry.closeTime,
      });
    }

    return normalized.sort(
      (a, b) => DAY_ORDER[a.dayOfWeek] - DAY_ORDER[b.dayOfWeek],
    );
  }
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

let service: OperatingHoursService;

export function getOperatingHoursService() {
  if (!service) {
    service = new OperatingHoursService();
  }

  return service;
}
