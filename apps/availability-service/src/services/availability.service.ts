import { LambdaRequest, NotFoundError, ValidationError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { assertCanManageSchedule, getAuthenticatedUserId } from '../auth/access';
import { DAY_OF_WEEK, DayOfWeek, ENTITY_TYPE } from '../domain/constants';
import { AvailabilityKeyBuilder } from '../domain/keys';
import { assertTimeZone, isValidTime, timeToMinutes } from '../domain/time';
import { toWorkingHoursView } from '../domain/view';
import { AvailabilityErrors } from '../errors';
import {
  AvailabilityRepository,
  getAvailabilityRepository,
} from '../repositories/availability.repository';
import { getSlotsService, SlotsService } from './slots.service';
import { WorkingHoursInterval, WorkingHoursItem, WorkingHoursView } from '../types/records';
import { pathParam, queryValue } from '../utils/request';

const baseLogger = createLogger({
  service: 'availability-service',
  redactPII: true,
});

export class AvailabilityService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'AvailabilityService',
  });

  constructor(
    private readonly repository: AvailabilityRepository = getAvailabilityRepository(),
    private readonly slots: SlotsService = getSlotsService(),
  ) {}

  async getworkinghours(request: LambdaRequest): Promise<
    WorkingHoursView | { items: WorkingHoursView[] }
  > {
    getAuthenticatedUserId(request);
    const vendorId = pathParam(request, 'vendorId');
    const branchId = queryValue(request, 'branchId');
    if (!branchId) {
      const indexes = await this.repository.listWorkingHours(vendorId);
      const items: WorkingHoursView[] = [];
      for (const index of indexes) {
        const hours = await this.repository.getWorkingHours(vendorId, index.branchId);
        if (hours) {
          items.push(toWorkingHoursView(hours));
        }
      }
      return { items };
    }
    assertBranch(branchId);
    const hours = await this.repository.getWorkingHours(vendorId, branchId);
    if (!hours) {
      throw new NotFoundError('Working hours not found');
    }
    return toWorkingHoursView(hours);
  }

  async putworkinghours(request: LambdaRequest): Promise<WorkingHoursView> {
    const vendorId = pathParam(request, 'vendorId');
    const existingBranch = queryValue(request, 'branchId');
    const body = (request.body ?? {}) as {
      branchId?: string;
      timezone?: string;
      dayOfWeek?: string;
      openTime?: string;
      closeTime?: string;
      closed?: boolean;
      hours?: WorkingHoursInterval[];
    };
    const branchId = body.branchId?.trim() || existingBranch;
    if (!branchId) {
      throw new ValidationError('branchId is required');
    }
    assertBranch(branchId);
    const existing = await this.repository.getWorkingHours(vendorId, branchId);
    const userId = assertCanManageSchedule(request, existing);
    const timezone = body.timezone?.trim() || existing?.timezone;
    if (!timezone) {
      throw new ValidationError('timezone is required');
    }
    try {
      assertTimeZone(timezone);
    } catch {
      throw new ValidationError('timezone must be a valid IANA time zone');
    }

    const hours = body.hours
      ? normalizeWeek(body.hours)
      : upsertDay(existing?.hours ?? [], body);

    const now = new Date().toISOString();
    const item: WorkingHoursItem = {
      PK: AvailabilityKeyBuilder.schedulePk(vendorId, branchId),
      SK: AvailabilityKeyBuilder.scheduleSk(),
      entityType: ENTITY_TYPE.WORKING_HOURS,
      vendorId,
      branchId,
      timezone,
      ownerUserId: existing?.ownerUserId ?? userId,
      hours,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.repository.saveWorkingHours(item, {
      PK: AvailabilityKeyBuilder.scheduleIndexPk(vendorId),
      SK: AvailabilityKeyBuilder.scheduleIndexSk(branchId),
      entityType: ENTITY_TYPE.SCHEDULE_INDEX,
      vendorId,
      branchId,
      createdAt: existing?.createdAt ?? now,
    });
    this.logger.info({ event: 'working_hours_saved', vendorId, branchId });
    return toWorkingHoursView(item);
  }

  async getavailability(request: LambdaRequest) {
    const date = queryValue(request, 'date');
    if (!date) {
      throw new ValidationError('date is required');
    }
    const result = await this.slots.getslots({
      ...request,
      params: {
        ...(request.params ?? {}),
        bookable: 'true',
        date,
      },
    });
    if (result.items.length === 0) {
      const branchId = queryValue(request, 'branchId');
      const vendorId = pathParam(request, 'vendorId');
      if (branchId) {
        const schedule = await this.repository.getWorkingHours(vendorId, branchId);
        if (!schedule) {
          throw AvailabilityErrors.vendorNotAvailable(
            'Working hours are not configured for this branch',
          );
        }
      }
    }
    return result;
  }
}

function assertBranch(branchId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(branchId)) {
    throw new ValidationError('branchId is invalid');
  }
}

function normalizeWeek(hours: WorkingHoursInterval[]): WorkingHoursInterval[] {
  if (!Array.isArray(hours) || hours.length === 0) {
    throw new ValidationError('hours must contain at least one day');
  }
  const seen = new Set<string>();
  const normalized = hours.map((entry) => normalizeInterval(entry, seen));
  return normalized.sort(
    (left, right) => DAY_OF_WEEK.indexOf(left.dayOfWeek) - DAY_OF_WEEK.indexOf(right.dayOfWeek),
  );
}

function upsertDay(
  existing: WorkingHoursInterval[],
  body: {
    dayOfWeek?: string;
    openTime?: string;
    closeTime?: string;
    closed?: boolean;
  },
): WorkingHoursInterval[] {
  if (!body.dayOfWeek) {
    throw new ValidationError('hours or dayOfWeek is required');
  }
  const seen = new Set(existing.map((entry) => entry.dayOfWeek));
  seen.delete(body.dayOfWeek as DayOfWeek);
  const next = normalizeInterval(
    {
      dayOfWeek: body.dayOfWeek as DayOfWeek,
      closed: body.closed ?? false,
      openTime: body.openTime,
      closeTime: body.closeTime,
    },
    seen,
  );
  return [...existing.filter((entry) => entry.dayOfWeek !== next.dayOfWeek), next].sort(
    (left, right) => DAY_OF_WEEK.indexOf(left.dayOfWeek) - DAY_OF_WEEK.indexOf(right.dayOfWeek),
  );
}

function normalizeInterval(
  entry: WorkingHoursInterval,
  seen: Set<string>,
): WorkingHoursInterval {
  if (!DAY_OF_WEEK.includes(entry.dayOfWeek)) {
    throw new ValidationError('dayOfWeek must be MON, TUE, WED, THU, FRI, SAT, or SUN');
  }
  if (seen.has(entry.dayOfWeek)) {
    throw new ValidationError(`Duplicate hours for ${entry.dayOfWeek}`);
  }
  seen.add(entry.dayOfWeek);
  if (entry.closed) {
    return { dayOfWeek: entry.dayOfWeek, closed: true };
  }
  if (!entry.openTime || !entry.closeTime || !isValidTime(entry.openTime) || !isValidTime(entry.closeTime)) {
    throw new ValidationError(`openTime and closeTime are required for ${entry.dayOfWeek}`);
  }
  if (timeToMinutes(entry.closeTime) <= timeToMinutes(entry.openTime)) {
    throw new ValidationError(`closeTime must be after openTime for ${entry.dayOfWeek}`);
  }
  return {
    dayOfWeek: entry.dayOfWeek,
    closed: false,
    openTime: entry.openTime,
    closeTime: entry.closeTime,
  };
}

let service: AvailabilityService;

export function getAvailabilityService(): AvailabilityService {
  if (!service) {
    service = new AvailabilityService();
  }
  return service;
}
