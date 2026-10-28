import { ConflictError, ForbiddenError, LambdaRequest, NotFoundError, ValidationError } from '@api-hub/utils';

import { getAuthenticatedUserId } from '../auth/access';
import { env } from '../configs/env.config';
import {
  VISIT_HORIZON_DAYS,
  assertVisitDraft,
  bookableBlock,
  crewKey,
  datedWindow,
  occurrenceDates,
  oneOffScheduleId,
  recurringScheduleId,
  schedulesOverlap,
  todayInTimeZone,
  visitIdFor,
  type VisitWindowInput,
} from '../domain/community-visits';
import { HOLD_STATUS } from '../domain/constants';
import { newHoldId } from '../domain/ids';
import { addCivilDays, civilDatesInclusive, hourBucketsEndingAt, isValidDate } from '../domain/time';
import {
  CommunityVisitHoldRecord,
  CommunityVisitScheduleRecord,
  CommunityVisitStore,
  DatedCommunityVisitRecord,
  DynamoCommunityVisitStore,
  VisitReservationRecord,
} from '../repositories/community-visits.repository';
import { getHolidaysRepository, HolidaysRepository } from '../repositories/holidays.repository';
import { headerValue, parseLimit, queryValue } from '../utils/request';

export const VISIT_PERMISSION = {
  VIEW: 'visits:view',
  PUBLISH: 'visits:publish',
  MANAGE: 'visits:manage',
} as const;

export interface VisitActor {
  userId: string;
  vendorId: string;
  role: 'owner' | 'staff';
  staffId?: string;
  permissions: string[];
  vendorActive: boolean;
  communityIds: string[];
}

export interface VisitAccessPort {
  resolve(request: LambdaRequest, vendorId: string): Promise<VisitActor>;
}

export interface PublishVisitInput {
  communityId: string;
  communityName?: string;
  locality?: string;
  city?: string;
  timezone: string;
  days: number[];
  startTime: string;
  endTime: string;
  effectiveDate: string;
  capacity: number;
  bookingCutoffMinutes: number;
  oneOff: boolean;
  active?: boolean;
  expectedVersion?: number;
  idempotencyKey: string;
}

export interface VisitView extends DatedCommunityVisitRecord {
  bookingIds: string[];
  available: number;
}

/** Customer-facing bookable community visit occurrence. */
export interface BookableVisitOccurrence {
  id: string;
  visitId: string;
  scheduleId: string;
  vendorId: string;
  communityId: string;
  communityName?: string;
  locality?: string;
  city?: string;
  date: string;
  startTime: string;
  endTime: string;
  startAt: string;
  endAt: string;
  timezone: string;
  overnight: boolean;
  capacity: number;
  heldCount: number;
  bookedCount: number;
  available: number;
  status: 'available';
  oneOff: boolean;
}

export interface VisitHoldView {
  id: string;
  holdId: string;
  visitId: string;
  vendorId: string;
  communityId: string;
  status: string;
  expiresAt: string;
  units: number;
  createdAt: string;
  customerId?: string;
  bookingId?: string;
}

const PERMISSION_BY_ROLE = {
  owner: [VISIT_PERMISSION.VIEW, VISIT_PERMISSION.PUBLISH, VISIT_PERMISSION.MANAGE],
  staff: [VISIT_PERMISSION.VIEW],
};

export class CommunityVisitsService {
  constructor(
    private readonly store: CommunityVisitStore,
    private readonly access: VisitAccessPort,
    private readonly now: () => Date = () => new Date(),
    private readonly holidays: HolidaysRepository = getHolidaysRepository(),
    private readonly holdTtlSeconds: number = env.SLOT_HOLD_TTL_SECONDS,
  ) {}

  async listSchedules(request: LambdaRequest, vendorId: string) {
    const actor = await this.access.resolve(request, vendorId);
    this.assert(actor, VISIT_PERMISSION.VIEW);
    if (actor.role !== 'owner') throw new ForbiddenError('Community schedules are limited to the business owner');
    const communityId = queryValue(request, 'communityId');
    const schedules = await this.store.listSchedules(vendorId);
    return {
      items: schedules.filter((schedule) => {
        if (communityId && schedule.communityId !== communityId) return false;
        return actor.communityIds.includes(schedule.communityId) || schedule.oneOff;
      }),
    };
  }

  async publish(request: LambdaRequest, vendorId: string, input: PublishVisitInput) {
    const actor = await this.access.resolve(request, vendorId);
    this.assert(actor, VISIT_PERMISSION.PUBLISH);
    if (!actor.vendorActive) throw new ConflictError('Community visits can be published after the vendor is approved');
    if (!actor.communityIds.includes(input.communityId)) throw new NotFoundError('Community is not assigned to this vendor');
    const replay = await this.store.getIdempotency(vendorId, input.idempotencyKey);
    if (replay) return replay;
    assertVisitDraft({ ...input, now: this.now() });
    const scheduleId = input.oneOff ? oneOffScheduleId(input.idempotencyKey) : recurringScheduleId(input.communityId);
    const existing = input.oneOff ? null : await this.store.getSchedule(vendorId, scheduleId);
    if (existing && input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
      throw new ConflictError('This schedule was updated. Refresh and try again.');
    }
    const candidate = this.toWindow(input);
    const schedules = await this.store.listSchedules(vendorId);
    if (schedules.some((schedule) => schedule.scheduleId !== scheduleId && schedule.active !== false && schedulesOverlap(candidate, this.toWindow(schedule)))) {
      throw new ConflictError('This visit overlaps another community visit for the same crew. Adjust its days or time.');
    }
    const timestamp = this.now().toISOString();
    const schedule: CommunityVisitScheduleRecord = {
      scheduleId,
      vendorId,
      communityId: input.communityId,
      communityName: clean(input.communityName),
      locality: clean(input.locality),
      city: clean(input.city),
      timezone: input.timezone,
      days: input.oneOff ? [] : [...new Set(input.days)].sort((left, right) => left - right),
      startTime: input.startTime,
      endTime: input.endTime,
      effectiveDate: input.effectiveDate,
      capacity: input.capacity,
      bookingCutoffMinutes: input.bookingCutoffMinutes,
      oneOff: input.oneOff,
      active: input.active !== false,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      updatedBy: actor.userId,
    };
    await this.store.saveSchedule(schedule);
    const preserved = await this.reconcile(schedule, actor.communityIds, actor.vendorActive);
    const body = { schedule: this.scheduleView(schedule), preservedVisits: preserved };
    await this.store.saveIdempotency(vendorId, input.idempotencyKey, body);
    return body;
  }

  async deactivateSchedule(request: LambdaRequest, vendorId: string, scheduleId: string, input: { expectedVersion: number; idempotencyKey: string }) {
    const actor = await this.access.resolve(request, vendorId);
    this.assert(actor, VISIT_PERMISSION.PUBLISH);
    const replay = await this.store.getIdempotency(vendorId, input.idempotencyKey);
    if (replay) return replay;
    const existing = await this.store.getSchedule(vendorId, scheduleId);
    if (!existing) throw new NotFoundError('Schedule not found');
    if (!actor.communityIds.includes(existing.communityId)) throw new NotFoundError('Community is not assigned to this vendor');
    if (existing.version !== input.expectedVersion) {
      throw new ConflictError('This schedule was updated. Refresh and try again.');
    }
    const schedule: CommunityVisitScheduleRecord = {
      ...existing,
      active: false,
      version: existing.version + 1,
      updatedAt: this.now().toISOString(),
      updatedBy: actor.userId,
    };
    await this.store.saveSchedule(schedule);
    const preserved = await this.reconcile(schedule, actor.communityIds, actor.vendorActive);
    const body = { schedule: this.scheduleView(schedule), preservedVisits: preserved };
    await this.store.saveIdempotency(vendorId, input.idempotencyKey, body);
    return body;
  }

  async listVisits(request: LambdaRequest, vendorId: string, options: {
    fromDate?: string;
    toDate?: string;
    communityId?: string;
    limit: number;
    cursor?: string;
  }) {
    const actor = await this.access.resolve(request, vendorId);
    this.assert(actor, VISIT_PERMISSION.VIEW);
    if (actor.role === 'owner') {
      const schedules = (await this.store.listSchedules(vendorId)).filter((schedule) => actor.communityIds.includes(schedule.communityId));
      for (const schedule of schedules) await this.reconcile(schedule, actor.communityIds, actor.vendorActive);
    }
    const visits = await this.visibleVisits(vendorId, actor);
    const sorted = visits
      .filter((visit) => {
        if (options.communityId && visit.communityId !== options.communityId) return false;
        if (options.fromDate && visit.date < options.fromDate) return false;
        if (options.toDate && visit.date > options.toDate) return false;
        return true;
      })
      .sort((left, right) => `${left.date}${left.startAt}`.localeCompare(`${right.date}${right.startAt}`));
    const start = options.cursor ? sorted.findIndex((visit) => visit.visitId === options.cursor) + 1 : 0;
    if (options.cursor && start <= 0) throw new ValidationError('cursor is invalid');
    const page = sorted.slice(start, start + options.limit);
    const views = await Promise.all(page.map((visit) => this.viewFor(actor, visit)));
    const next = sorted[start + options.limit];
    return { items: views, nextCursor: next?.visitId, nextToken: next?.visitId };
  }

  /**
   * Canonical customer availability: bookable dated community visit occurrences
   * for a community and date range, optionally limited to one vendor.
   */
  async listBookableOccurrences(request: LambdaRequest, input: {
    communityId: string;
    fromDate: string;
    toDate: string;
    vendorId?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ items: BookableVisitOccurrence[]; nextToken?: string; nextCursor?: string }> {
    getAuthenticatedUserId(request);
    if (!isValidDate(input.fromDate) || !isValidDate(input.toDate)) {
      throw new ValidationError('fromDate and toDate must be YYYY-MM-DD');
    }
    if (input.fromDate > input.toDate) {
      throw new ValidationError('fromDate must be on or before toDate');
    }
    const dates = civilDatesInclusive(input.fromDate, input.toDate);
    if (dates.length > 31) {
      throw new ValidationError('Date range cannot exceed 31 days');
    }
    const visits = await this.store.listVisitsByCommunity(input.communityId, {
      fromDate: input.fromDate,
      toDate: input.toDate,
      vendorId: input.vendorId,
    });
    const holidayCache = new Map<string, Set<string>>();
    const instant = this.now();
    const bookable: BookableVisitOccurrence[] = [];
    for (const visit of visits) {
      if (!holidayCache.has(visit.vendorId)) {
        holidayCache.set(visit.vendorId, await this.vendorHolidayDates(visit.vendorId, dates));
      }
      if (holidayCache.get(visit.vendorId)?.has(visit.date)) continue;
      const block = bookableBlock({
        ...visit,
        units: 1,
        covered: true,
        vendorActive: true,
        now: instant,
      });
      if (block) continue;
      const available = visit.capacity - visit.bookedCount - visit.heldCount;
      if (available <= 0) continue;
      bookable.push(this.toBookable(visit, available));
    }
    bookable.sort((left, right) => `${left.date}${left.startAt}${left.vendorId}`.localeCompare(`${right.date}${right.startAt}${right.vendorId}`));
    const limit = input.limit ?? parseLimit(undefined);
    const start = input.cursor
      ? bookable.findIndex((item) => item.visitId === input.cursor) + 1
      : 0;
    if (input.cursor && start <= 0) throw new ValidationError('cursor is invalid');
    const page = bookable.slice(start, start + limit);
    const next = bookable[start + limit];
    return {
      items: page,
      ...(next ? { nextToken: next.visitId, nextCursor: next.visitId } : {}),
    };
  }

  async updateCapacity(request: LambdaRequest, vendorId: string, visitId: string, input: { capacity: number; expectedVersion: number; idempotencyKey: string }) {
    const actor = await this.access.resolve(request, vendorId);
    this.assert(actor, VISIT_PERMISSION.MANAGE);
    const replay = await this.store.getIdempotency(vendorId, input.idempotencyKey);
    if (replay) return replay;
    const visit = await this.requireVisit(vendorId, visitId);
    if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 100) throw new ValidationError('Capacity must be a whole number from 1 to 100');
    if (input.capacity < visit.bookedCount + visit.heldCount) {
      throw new ValidationError('Capacity cannot be lower than confirmed reservations and active holds');
    }
    const next = { ...visit, capacity: input.capacity, exception: true, version: visit.version + 1, updatedAt: this.now().toISOString() };
    await this.store.replaceVisit(next, input.expectedVersion);
    const body = await this.viewFor(actor, next);
    await this.store.saveIdempotency(vendorId, input.idempotencyKey, body);
    return body;
  }

  async cancel(request: LambdaRequest, vendorId: string, visitId: string, input: { expectedVersion: number; idempotencyKey: string }) {
    const actor = await this.access.resolve(request, vendorId);
    this.assert(actor, VISIT_PERMISSION.MANAGE);
    const replay = await this.store.getIdempotency(vendorId, input.idempotencyKey);
    if (replay) return replay;
    const visit = await this.requireVisit(vendorId, visitId);
    const next = { ...visit, status: 'cancelled' as const, exception: true, version: visit.version + 1, updatedAt: this.now().toISOString() };
    await this.store.replaceVisit(next, input.expectedVersion);
    const reservations = await this.store.listReservations(vendorId, visitId);
    const body = {
      ...(await this.viewFor(actor, next)),
      affectedBookingCount: reservations.filter((item) => item.status === 'booked').length,
      bookingsCancelled: false,
    };
    await this.store.saveIdempotency(vendorId, input.idempotencyKey, body);
    return body;
  }

  /** Restore a cancelled exception occurrence so it is bookable again. */
  async unblock(request: LambdaRequest, vendorId: string, visitId: string, input: { expectedVersion: number; idempotencyKey: string }) {
    const actor = await this.access.resolve(request, vendorId);
    this.assert(actor, VISIT_PERMISSION.MANAGE);
    const replay = await this.store.getIdempotency(vendorId, input.idempotencyKey);
    if (replay) return replay;
    const visit = await this.requireVisit(vendorId, visitId);
    if (visit.status !== 'cancelled') {
      throw new ConflictError('Visit is not blocked');
    }
    const next = {
      ...visit,
      status: 'scheduled' as const,
      exception: true,
      version: visit.version + 1,
      updatedAt: this.now().toISOString(),
    };
    await this.store.replaceVisit(next, input.expectedVersion);
    const body = await this.viewFor(actor, next);
    await this.store.saveIdempotency(vendorId, input.idempotencyKey, body);
    return body;
  }

  async createHold(request: LambdaRequest, input: {
    vendorId: string;
    visitId: string;
    units?: number;
    idempotencyKey: string;
  }): Promise<VisitHoldView> {
    const customerId = getAuthenticatedUserId(request);
    const units = input.units ?? 1;
    if (!Number.isInteger(units) || units < 1 || units > 20) {
      throw new ValidationError('units must be an integer between 1 and 20');
    }
    const replay = await this.store.getHoldByIdempotency(customerId, input.idempotencyKey);
    if (replay) return this.toHoldView(replay, true);
    const visit = await this.requireVisit(input.vendorId, input.visitId);
    // Revalidate against the authoritative occurrence (GSI browse is eventually consistent).
    const holidays = await this.vendorHolidayDates(visit.vendorId, [visit.date]);
    if (holidays.has(visit.date)) {
      throw new ConflictError('Visit is not bookable: holiday');
    }
    const block = bookableBlock({
      ...visit,
      units,
      covered: true,
      vendorActive: true,
      now: this.now(),
    });
    if (block) throw new ConflictError(`Visit is not bookable: ${block}`);
    const instant = this.now();
    const hold: CommunityVisitHoldRecord = {
      holdId: newHoldId(),
      visitId: visit.visitId,
      vendorId: visit.vendorId,
      communityId: visit.communityId,
      customerId,
      units,
      status: HOLD_STATUS.ACTIVE,
      createdAt: instant.toISOString(),
      updatedAt: instant.toISOString(),
      expiresAt: new Date(instant.getTime() + this.holdTtlSeconds * 1000).toISOString(),
    };
    const created = await this.store.createHold({ visit, hold, idempotencyKey: input.idempotencyKey });
    return this.toHoldView(created, true);
  }

  async findHold(holdId: string): Promise<CommunityVisitHoldRecord | null> {
    return this.store.getHold(holdId);
  }

  async getHold(request: LambdaRequest, holdId: string): Promise<VisitHoldView | null> {
    const hold = await this.store.getHold(holdId);
    if (!hold) return null;
    const userId = getAuthenticatedUserId(request);
    if (hold.customerId !== userId) {
      throw new ForbiddenError('Not authorized to read this hold');
    }
    return this.toHoldView(hold, true);
  }

  async releaseHold(request: LambdaRequest, holdId: string): Promise<VisitHoldView> {
    const hold = await this.store.getHold(holdId);
    if (!hold) throw new NotFoundError('Hold not found');
    const userId = getAuthenticatedUserId(request);
    if (hold.customerId !== userId) {
      throw new ForbiddenError('Not authorized to release this hold');
    }
    if (hold.status !== HOLD_STATUS.ACTIVE) return this.toHoldView(hold, true);
    const visit = await this.requireVisit(hold.vendorId, hold.visitId);
    return this.toHoldView(await this.store.releaseHold({ visit, hold, nextStatus: 'released' }), true);
  }

  async confirmHold(input: { holdId: string; bookingId: string }): Promise<{
    hold: VisitHoldView;
    visit: VisitView;
  }> {
    const hold = await this.store.getHold(input.holdId);
    if (!hold) throw new NotFoundError('Hold not found');
    if (hold.status === HOLD_STATUS.CONSUMED && hold.bookingId === input.bookingId) {
      const visit = await this.requireVisit(hold.vendorId, hold.visitId);
      return {
        hold: this.toHoldView(hold, true),
        visit: { ...visit, bookingIds: [input.bookingId], available: visit.capacity - visit.bookedCount - visit.heldCount },
      };
    }
    if (hold.status !== HOLD_STATUS.ACTIVE) throw new ConflictError('Hold is not active');
    if (hold.expiresAt <= this.now().toISOString()) {
      const visit = await this.requireVisit(hold.vendorId, hold.visitId);
      await this.store.releaseHold({ visit, hold, nextStatus: 'expired' });
      throw new ConflictError('Hold has expired');
    }
    const visit = await this.requireVisit(hold.vendorId, hold.visitId);
    const confirmed = await this.store.confirmHold({ visit, hold, bookingId: input.bookingId });
    return {
      hold: this.toHoldView(confirmed.hold, true),
      visit: {
        ...confirmed.visit,
        bookingIds: [input.bookingId],
        available: confirmed.visit.capacity - confirmed.visit.bookedCount - confirmed.visit.heldCount,
      },
    };
  }

  async expireDueHolds(instant = this.now()): Promise<{ expired: number; failed: number }> {
    const buckets = hourBucketsEndingAt(instant, env.EXPIRY_LOOKBACK_HOURS);
    const seen = new Set<string>();
    let expired = 0;
    let failed = 0;
    const nowIso = instant.toISOString();
    for (const bucket of buckets) {
      const candidates = await this.store.listExpiredHolds(nowIso, bucket);
      for (const hold of candidates) {
        if (seen.has(hold.holdId) || hold.status !== HOLD_STATUS.ACTIVE) continue;
        seen.add(hold.holdId);
        try {
          const visit = await this.store.getVisit(hold.vendorId, hold.visitId);
          if (!visit) continue;
          await this.store.releaseHold({ visit, hold, nextStatus: 'expired' });
          expired += 1;
        } catch {
          failed += 1;
        }
      }
    }
    return { expired, failed };
  }

  async listBookingRefs(request: LambdaRequest, vendorId: string, visitId: string) {
    const actor = await this.access.resolve(request, vendorId);
    this.assert(actor, VISIT_PERMISSION.VIEW);
    const visit = await this.requireVisit(vendorId, visitId);
    const visible = await this.visibleVisits(vendorId, actor);
    if (!visible.some((item) => item.visitId === visit.visitId)) throw new ForbiddenError('Not authorized to access this visit');
    const reservations = await this.reservationsFor(actor, visitId, vendorId);
    return { items: reservations.filter((item) => item.status === 'booked').map((item) => ({ bookingId: item.bookingId, units: item.units, staffId: actor.role === 'owner' ? item.staffId : undefined })) };
  }

  async reserve(request: LambdaRequest, vendorId: string, visitId: string, input: { bookingId: string; units: number; staffId?: string; idempotencyKey: string }) {
    const actor = await this.access.resolve(request, vendorId);
    this.assert(actor, VISIT_PERMISSION.PUBLISH);
    const replay = await this.store.getIdempotency(vendorId, input.idempotencyKey);
    if (replay) return replay;
    const visit = await this.requireVisit(vendorId, visitId);
    const block = bookableBlock({ ...visit, units: input.units, covered: actor.communityIds.includes(visit.communityId), vendorActive: actor.vendorActive, now: this.now() });
    if (block) throw new ConflictError(`Visit is not bookable: ${block}`);
    const updated = await this.store.reserve({ visit, bookingId: input.bookingId, units: input.units, staffId: input.staffId });
    const body = await this.viewFor(actor, updated);
    await this.store.saveIdempotency(vendorId, input.idempotencyKey, body);
    return body;
  }

  async release(request: LambdaRequest, vendorId: string, visitId: string, bookingId: string) {
    const actor = await this.access.resolve(request, vendorId);
    this.assert(actor, VISIT_PERMISSION.PUBLISH);
    const visit = await this.requireVisit(vendorId, visitId);
    return this.viewFor(actor, await this.store.release({ visit, bookingId }));
  }

  private async reconcile(schedule: CommunityVisitScheduleRecord, communityIds: string[], vendorActive: boolean) {
    const today = todayInTimeZone(schedule.timezone, this.now());
    const horizon = addCivilDays(today, VISIT_HORIZON_DAYS);
    const through = schedule.oneOff && schedule.effectiveDate > horizon ? schedule.effectiveDate : horizon;
    const wanted = new Set(
      schedule.active !== false && vendorActive && communityIds.includes(schedule.communityId)
        ? occurrenceDates(this.toWindow(schedule), today, through)
        : [],
    );
    const existing = (await this.store.listVisits(schedule.vendorId)).filter((visit) => visit.scheduleId === schedule.scheduleId);
    const preserved: Array<{ visitId: string; date: string; bookedCount: number; heldCount: number }> = [];
    for (const visit of existing) {
      if (visit.date < today) continue;
      const reserved = visit.bookedCount + visit.heldCount > 0;
      const keep = reserved || visit.exception || visit.status === 'cancelled';
      if (!wanted.has(visit.date)) {
        if (keep) {
          if (reserved) preserved.push({ visitId: visit.visitId, date: visit.date, bookedCount: visit.bookedCount, heldCount: visit.heldCount });
          continue;
        }
        await this.store.replaceVisit({ ...visit, status: 'cancelled', exception: true, version: visit.version + 1, updatedAt: this.now().toISOString() }, visit.version);
        continue;
      }
      if (keep) {
        if (reserved && this.windowChanged(visit, schedule)) {
          preserved.push({ visitId: visit.visitId, date: visit.date, bookedCount: visit.bookedCount, heldCount: visit.heldCount });
        }
        continue;
      }
      const refreshed = this.buildVisit(schedule, visit.date, visit.createdAt);
      if (this.windowChanged(visit, schedule) || visit.capacity !== schedule.capacity || visit.bookingCutoffMinutes !== schedule.bookingCutoffMinutes) {
        await this.store.replaceVisit({ ...refreshed, version: visit.version + 1 }, visit.version);
      }
    }
    for (const date of wanted) {
      const visitId = visitIdFor(schedule.scheduleId, date);
      if (existing.some((visit) => visit.visitId === visitId)) continue;
      await this.store.saveVisit(this.buildVisit(schedule, date, this.now().toISOString()));
    }
    return preserved;
  }

  private buildVisit(schedule: CommunityVisitScheduleRecord, date: string, createdAt: string): DatedCommunityVisitRecord {
    const window = datedWindow(date, schedule.startTime, schedule.endTime, schedule.timezone);
    return {
      visitId: visitIdFor(schedule.scheduleId, date),
      scheduleId: schedule.scheduleId,
      vendorId: schedule.vendorId,
      communityId: schedule.communityId,
      communityName: schedule.communityName,
      locality: schedule.locality,
      city: schedule.city,
      timezone: schedule.timezone,
      date,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      startAt: window.startAt,
      endAt: window.endAt,
      overnight: window.overnight,
      capacity: schedule.capacity,
      bookedCount: 0,
      heldCount: 0,
      status: 'scheduled',
      oneOff: schedule.oneOff,
      exception: false,
      bookingCutoffMinutes: schedule.bookingCutoffMinutes,
      crewId: schedule.crewId,
      version: 1,
      assignedStaffIds: [],
      createdAt,
      updatedAt: createdAt,
    };
  }

  private async visibleVisits(vendorId: string, actor: VisitActor) {
    const visits = await this.store.listVisits(vendorId);
    if (actor.role === 'owner') return visits.filter((visit) => actor.communityIds.includes(visit.communityId) || visit.bookedCount + visit.heldCount > 0);
    return (await Promise.all(visits.map(async (visit) => {
      if (visit.assignedStaffIds.includes(actor.staffId ?? '')) return visit;
      const reservations = await this.store.listReservations(vendorId, visit.visitId);
      return reservations.some((item) => item.status === 'booked' && item.staffId && item.staffId === actor.staffId) ? visit : null;
    }))).filter((visit): visit is DatedCommunityVisitRecord => Boolean(visit));
  }

  private async reservationsFor(actor: VisitActor, visitId: string, vendorId: string) {
    const reservations = await this.store.listReservations(vendorId, visitId);
    if (actor.role === 'owner') return reservations;
    return reservations.filter((item) => item.staffId && item.staffId === actor.staffId);
  }

  private async viewFor(actor: VisitActor, visit: DatedCommunityVisitRecord): Promise<VisitView> {
    const reservations = await this.reservationsFor(actor, visit.visitId, visit.vendorId);
    return {
      ...visit,
      bookingIds: reservations.filter((item) => item.status === 'booked').map((item) => item.bookingId),
      available: Math.max(0, visit.capacity - visit.bookedCount - visit.heldCount),
    };
  }

  private async requireVisit(vendorId: string, visitId: string) {
    const visit = await this.store.getVisit(vendorId, visitId);
    if (!visit || visit.vendorId !== vendorId) throw new NotFoundError('Visit not found');
    return visit;
  }

  private assert(actor: VisitActor, permission: string) {
    if (!actor.permissions.includes(permission)) throw new ForbiddenError('Not authorized to manage community visits');
  }

  private toWindow(input: Pick<PublishVisitInput, 'days' | 'startTime' | 'endTime' | 'effectiveDate' | 'timezone' | 'oneOff'> & { crewId?: string }): VisitWindowInput {
    return { ...input, crewId: crewKey(input.crewId) === 'shared' ? undefined : input.crewId };
  }

  private windowChanged(visit: DatedCommunityVisitRecord, schedule: CommunityVisitScheduleRecord) {
    return visit.startTime !== schedule.startTime || visit.endTime !== schedule.endTime || visit.timezone !== schedule.timezone;
  }

  private scheduleView(schedule: CommunityVisitScheduleRecord) {
    return schedule;
  }

  private toBookable(visit: DatedCommunityVisitRecord, available: number): BookableVisitOccurrence {
    return {
      id: visit.visitId,
      visitId: visit.visitId,
      scheduleId: visit.scheduleId,
      vendorId: visit.vendorId,
      communityId: visit.communityId,
      communityName: visit.communityName,
      locality: visit.locality,
      city: visit.city,
      date: visit.date,
      startTime: visit.startTime,
      endTime: visit.endTime,
      startAt: visit.startAt,
      endAt: visit.endAt,
      timezone: visit.timezone,
      overnight: visit.overnight,
      capacity: visit.capacity,
      heldCount: visit.heldCount,
      bookedCount: visit.bookedCount,
      available,
      status: 'available',
      oneOff: visit.oneOff,
    };
  }

  private toHoldView(hold: CommunityVisitHoldRecord, includeCustomer: boolean): VisitHoldView {
    return {
      id: hold.holdId,
      holdId: hold.holdId,
      visitId: hold.visitId,
      vendorId: hold.vendorId,
      communityId: hold.communityId,
      status: hold.status,
      expiresAt: hold.expiresAt,
      units: hold.units,
      createdAt: hold.createdAt,
      ...(includeCustomer ? { customerId: hold.customerId } : {}),
      ...(hold.bookingId ? { bookingId: hold.bookingId } : {}),
    };
  }

  private async vendorHolidayDates(vendorId: string, dates: string[]): Promise<Set<string>> {
    const holidays = await this.holidays.listVendorHolidays(vendorId);
    const wanted = new Set(dates);
    const closed = new Set<string>();
    for (const holiday of holidays) {
      if (wanted.has(holiday.date)) closed.add(holiday.date);
    }
    return closed;
  }
}

export class HttpVisitAccess implements VisitAccessPort {
  constructor(private readonly baseUrl = process.env.VENDOR_BASE_URL ?? process.env.EXPO_PUBLIC_BW_VENDOR_API_URL ?? '') {}

  async resolve(request: LambdaRequest, vendorId: string): Promise<VisitActor> {
    if (!this.baseUrl) throw new ForbiddenError('Vendor membership could not be verified');
    const authorization = headerValue(request, 'authorization');
    if (!authorization) throw new ForbiddenError('Vendor membership could not be verified');
    const me = await this.get('/vendors/me', authorization) as {
      hasVendor?: boolean;
      vendorId?: string;
      status?: string;
      membership?: { role?: string; staffId?: string; permissions?: string[] };
    };
    if (!me.hasVendor || me.vendorId !== vendorId || !me.membership?.role) throw new ForbiddenError('Not authorized to access this vendor');
    const role = me.membership.role === 'staff' ? 'staff' : me.membership.role === 'owner' ? 'owner' : undefined;
    if (!role) throw new ForbiddenError('Not authorized to access this vendor');
    const permissions = Array.isArray(me.membership?.permissions) ? me.membership?.permissions.filter((item): item is string => typeof item === 'string') : PERMISSION_BY_ROLE[role];
    let communityIds: string[] = [];
    if (me.membership?.role === 'owner') {
      const coverage = await this.get(`/vendors/${encodeURIComponent(vendorId)}/communities`, authorization);
      communityIds = communityIdsFrom(coverage);
    }
    return {
      userId: request.context.authContext?.userId ?? request.context.userContext?.userId ?? '',
      vendorId,
      role: me.membership?.role as 'owner' | 'staff' ?? 'owner',
      staffId: me.membership?.staffId,
      permissions,
      vendorActive: me.status === 'ACTIVE' || me.status === 'APPROVED',
      communityIds,
    };
  }

  private async get(path: string, authorization: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { headers: { authorization, accept: 'application/json' } });
    if (response.status === 401 || response.status === 403) throw new ForbiddenError('Not authorized to access this vendor');
    if (!response.ok) throw new ForbiddenError('Vendor membership could not be verified');
    return response.json() as Promise<unknown>;
  }
}

export function communityIdsFrom(value: unknown): string[] {
  const root = value && typeof value === 'object' ? value as { data?: unknown; items?: unknown } : undefined;
  const data = root?.data && typeof root.data === 'object' ? root.data as { items?: unknown } : undefined;
  const items = Array.isArray(value) ? value : Array.isArray(root?.items) ? root.items : Array.isArray(root?.data) ? root.data : Array.isArray(data?.items) ? data.items : [];
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as { id?: unknown; communityId?: unknown };
    const id = typeof record.communityId === 'string' ? record.communityId : typeof record.id === 'string' ? record.id : '';
    return id ? [id] : [];
  });
}

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

let service: CommunityVisitsService;
export function getCommunityVisitsService() {
  if (!service) service = new CommunityVisitsService(new DynamoCommunityVisitStore(), new HttpVisitAccess());
  return service;
}

export type { VisitReservationRecord };
