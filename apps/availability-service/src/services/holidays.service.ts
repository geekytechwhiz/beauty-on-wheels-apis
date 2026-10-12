import { LambdaRequest, ValidationError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { assertCanManageSchedule, getAuthenticatedUserId } from '../auth/access';
import { ENTITY_TYPE } from '../domain/constants';
import { newHolidayId } from '../domain/ids';
import { AvailabilityKeyBuilder } from '../domain/keys';
import { isValidDate } from '../domain/time';
import { toHolidayView } from '../domain/view';
import { AvailabilityErrors } from '../errors';
import {
  AvailabilityRepository,
  getAvailabilityRepository,
} from '../repositories/availability.repository';
import { getHolidaysRepository, HolidaysRepository } from '../repositories/holidays.repository';
import { getHoldsService, HoldsService } from './holds.service';
import { HolidayItem, HolidayLookupItem, HolidayView } from '../types/records';
import { pathParam, queryValue } from '../utils/request';

const baseLogger = createLogger({
  service: 'holidays-service',
  redactPII: true,
});

export class HolidaysService {
  private readonly logger = createChildLogger(baseLogger, { service: 'HolidaysService' });

  constructor(
    private readonly repository: HolidaysRepository = getHolidaysRepository(),
    private readonly schedules: AvailabilityRepository = getAvailabilityRepository(),
    private readonly holds: HoldsService = getHoldsService(),
  ) {}

  async postslotholds(request: LambdaRequest) {
    return this.holds.postslotholds(request);
  }

  async deleteslothold(request: LambdaRequest) {
    return this.holds.deleteslothold(request);
  }

  async getslothold(request: LambdaRequest) {
    return this.holds.getslothold(request);
  }

  async getholidays(request: LambdaRequest): Promise<{ items: HolidayView[] }> {
    getAuthenticatedUserId(request);
    const vendorId = pathParam(request, 'vendorId');
    const branchId = queryValue(request, 'branchId');
    const items = branchId
      ? [
          ...(await this.repository.listBranchHolidays(vendorId, branchId)),
          ...(await this.repository.listVendorHolidays(vendorId)),
        ]
      : await this.repository.listAllHolidays(vendorId);
    return {
      items: items
        .sort((left, right) => left.date.localeCompare(right.date))
        .map(toHolidayView),
    };
  }

  async postholidays(request: LambdaRequest): Promise<HolidayView> {
    const vendorId = pathParam(request, 'vendorId');
    const body = (request.body ?? {}) as {
      branchId?: string;
      date?: string;
      name?: string;
    };
    const date = requireDate(body.date);
    const branchId = optionalBranch(body.branchId);
    await this.assertWriter(request, vendorId, branchId);
    const now = new Date().toISOString();
    const holidayId = newHolidayId();
    const records = buildHoliday({
      holidayId,
      vendorId,
      branchId,
      date,
      holidayName: optionalName(body.name),
      createdAt: now,
      updatedAt: now,
    });
    await this.repository.createHoliday(records);
    this.logger.info({ event: 'holiday_created', vendorId, holidayId, date });
    return toHolidayView(records.holiday);
  }

  async patchholiday(request: LambdaRequest): Promise<HolidayView> {
    const vendorId = pathParam(request, 'vendorId');
    const holidayId = pathParam(request, 'holidayId');
    const lookup = await this.requireLookup(vendorId, holidayId);
    const body = (request.body ?? {}) as {
      branchId?: string;
      date?: string;
      name?: string;
    };
    const branchId = body.branchId === undefined ? lookup.branchId : optionalBranch(body.branchId);
    const date = body.date === undefined ? lookup.date : requireDate(body.date);
    const holidayName =
      body.name === undefined ? lookup.holidayName : optionalName(body.name);
    await this.assertWriter(request, vendorId, branchId);
    const now = new Date().toISOString();
    const records = buildHoliday({
      holidayId,
      vendorId,
      branchId,
      date,
      holidayName,
      createdAt: lookup.createdAt,
      updatedAt: now,
    });
    await this.repository.replaceHoliday({
      previousPk: lookup.canonicalPk,
      previousSk: lookup.canonicalSk,
      previousIndexPk: lookup.indexPk,
      previousIndexSk: lookup.indexSk,
      ...records,
    });
    this.logger.info({ event: 'holiday_updated', vendorId, holidayId });
    return toHolidayView(records.holiday);
  }

  async deleteholiday(request: LambdaRequest): Promise<{ id: string; deleted: true }> {
    const vendorId = pathParam(request, 'vendorId');
    const holidayId = pathParam(request, 'holidayId');
    const lookup = await this.requireLookup(vendorId, holidayId);
    await this.assertWriter(request, vendorId, lookup.branchId);
    await this.repository.deleteHoliday(lookup);
    this.logger.info({ event: 'holiday_deleted', vendorId, holidayId });
    return { id: holidayId, deleted: true };
  }

  private async assertWriter(
    request: LambdaRequest,
    vendorId: string,
    branchId?: string,
  ): Promise<void> {
    if (!branchId) {
      assertCanManageSchedule(request, null);
      return;
    }
    const schedule = await this.schedules.getWorkingHours(vendorId, branchId);
    assertCanManageSchedule(request, schedule);
  }

  private async requireLookup(vendorId: string, holidayId: string): Promise<HolidayLookupItem> {
    const lookup = await this.repository.getLookup(holidayId);
    if (!lookup || lookup.vendorId !== vendorId) {
      throw AvailabilityErrors.holidayNotFound();
    }
    return lookup;
  }
}

function requireDate(value: unknown): string {
  if (typeof value !== 'string' || !isValidDate(value)) {
    throw new ValidationError('date must be YYYY-MM-DD');
  }
  return value;
}

function optionalBranch(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(value)) {
    throw new ValidationError('branchId is invalid');
  }
  return value;
}

function optionalName(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length > 120) {
    throw new ValidationError('name must be a string up to 120 characters');
  }
  return value.trim();
}

function buildHoliday(input: {
  holidayId: string;
  vendorId: string;
  branchId?: string;
  date: string;
  holidayName?: string;
  createdAt: string;
  updatedAt: string;
}): { holiday: HolidayItem; index: HolidayItem; lookup: HolidayLookupItem } {
  const canonicalPk = input.branchId
    ? AvailabilityKeyBuilder.branchHolidayPk(input.vendorId, input.branchId)
    : AvailabilityKeyBuilder.vendorHolidayPk(input.vendorId);
  const canonicalSk = AvailabilityKeyBuilder.holidaySk(input.date, input.holidayId);
  const indexPk = AvailabilityKeyBuilder.holidayIndexPk(input.vendorId);
  const indexSk = AvailabilityKeyBuilder.holidayIndexSk(input.date, input.holidayId);
  const shared = {
    holidayId: input.holidayId,
    vendorId: input.vendorId,
    ...(input.branchId ? { branchId: input.branchId } : {}),
    date: input.date,
    ...(input.holidayName ? { holidayName: input.holidayName } : {}),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
  return {
    holiday: {
      PK: canonicalPk,
      SK: canonicalSk,
      entityType: ENTITY_TYPE.HOLIDAY,
      ...shared,
    },
    index: {
      PK: indexPk,
      SK: indexSk,
      entityType: ENTITY_TYPE.HOLIDAY_INDEX,
      ...shared,
    },
    lookup: {
      PK: AvailabilityKeyBuilder.holidayLookupPk(input.holidayId),
      SK: 'META',
      entityType: ENTITY_TYPE.HOLIDAY_LOOKUP,
      ...shared,
      canonicalPk,
      canonicalSk,
      indexPk,
      indexSk,
    },
  };
}

let service: HolidaysService;

export function getHolidaysService(): HolidaysService {
  if (!service) {
    service = new HolidaysService();
  }
  return service;
}
