import { ConditionalWriteConflictError, ConflictError } from '@api-hub/utils';

import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import { GSI1_INDEX, HOLD_STATUS, HoldStatus } from '../domain/constants';
import { AvailabilityKeyBuilder } from '../domain/keys';
import { expiryHourBucket } from '../domain/time';

export interface CommunityVisitScheduleRecord {
  scheduleId: string;
  vendorId: string;
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
  /** Inactive schedules stop generating new occurrences; reserved visits are preserved. */
  active: boolean;
  crewId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface DatedCommunityVisitRecord {
  visitId: string;
  scheduleId: string;
  vendorId: string;
  communityId: string;
  communityName?: string;
  locality?: string;
  city?: string;
  timezone: string;
  date: string;
  startTime: string;
  endTime: string;
  startAt: string;
  endAt: string;
  overnight: boolean;
  capacity: number;
  bookedCount: number;
  heldCount: number;
  status: 'scheduled' | 'cancelled';
  oneOff: boolean;
  exception: boolean;
  bookingCutoffMinutes: number;
  crewId?: string;
  version: number;
  assignedStaffIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VisitReservationRecord {
  visitId: string;
  bookingId: string;
  vendorId: string;
  units: number;
  staffId?: string;
  status: 'booked' | 'released';
}

export interface CommunityVisitHoldRecord {
  holdId: string;
  visitId: string;
  vendorId: string;
  communityId: string;
  customerId: string;
  units: number;
  status: HoldStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  bookingId?: string;
}

export interface CommunityVisitStore {
  listSchedules(vendorId: string): Promise<CommunityVisitScheduleRecord[]>;
  getSchedule(vendorId: string, scheduleId: string): Promise<CommunityVisitScheduleRecord | null>;
  saveSchedule(record: CommunityVisitScheduleRecord): Promise<void>;
  listVisits(vendorId: string, options?: { fromDate?: string; toDate?: string }): Promise<DatedCommunityVisitRecord[]>;
  listVisitsByCommunity(communityId: string, options: {
    fromDate: string;
    toDate: string;
    vendorId?: string;
  }): Promise<DatedCommunityVisitRecord[]>;
  getVisit(vendorId: string, visitId: string): Promise<DatedCommunityVisitRecord | null>;
  saveVisit(record: DatedCommunityVisitRecord): Promise<'created' | 'exists'>;
  replaceVisit(record: DatedCommunityVisitRecord, expectedVersion: number): Promise<void>;
  getReservation(vendorId: string, visitId: string, bookingId: string): Promise<VisitReservationRecord | null>;
  listReservations(vendorId: string, visitId: string): Promise<VisitReservationRecord[]>;
  reserve(input: { visit: DatedCommunityVisitRecord; bookingId: string; units: number; staffId?: string }): Promise<DatedCommunityVisitRecord>;
  release(input: { visit: DatedCommunityVisitRecord; bookingId: string }): Promise<DatedCommunityVisitRecord>;
  createHold(input: {
    visit: DatedCommunityVisitRecord;
    hold: CommunityVisitHoldRecord;
    idempotencyKey: string;
  }): Promise<CommunityVisitHoldRecord>;
  getHold(holdId: string): Promise<CommunityVisitHoldRecord | null>;
  getHoldByIdempotency(customerId: string, idempotencyKey: string): Promise<CommunityVisitHoldRecord | null>;
  releaseHold(input: {
    visit: DatedCommunityVisitRecord;
    hold: CommunityVisitHoldRecord;
    nextStatus: 'released' | 'expired';
  }): Promise<CommunityVisitHoldRecord>;
  confirmHold(input: {
    visit: DatedCommunityVisitRecord;
    hold: CommunityVisitHoldRecord;
    bookingId: string;
  }): Promise<{ visit: DatedCommunityVisitRecord; hold: CommunityVisitHoldRecord }>;
  listExpiredHolds(expiresAtOrBefore: string, hourBucket: string): Promise<CommunityVisitHoldRecord[]>;
  getIdempotency(vendorId: string, key: string): Promise<unknown | null>;
  saveIdempotency(vendorId: string, key: string, body: unknown): Promise<void>;
}

export class MemoryCommunityVisitStore implements CommunityVisitStore {
  readonly schedules = new Map<string, CommunityVisitScheduleRecord>();
  readonly visits = new Map<string, DatedCommunityVisitRecord>();
  readonly reservations = new Map<string, VisitReservationRecord>();
  readonly holds = new Map<string, CommunityVisitHoldRecord>();
  readonly holdIdempotency = new Map<string, string>();
  readonly idempotency = new Map<string, unknown>();

  async listSchedules(vendorId: string) {
    return [...this.schedules.values()].filter((item) => item.vendorId === vendorId).map(withActive);
  }

  async getSchedule(vendorId: string, scheduleId: string) {
    const item = this.schedules.get(this.key(vendorId, scheduleId));
    return item ? withActive(item) : null;
  }

  async saveSchedule(record: CommunityVisitScheduleRecord) {
    this.schedules.set(this.key(record.vendorId, record.scheduleId), {
      ...withActive(record),
      days: [...record.days],
    });
  }

  async listVisits(vendorId: string, options: { fromDate?: string; toDate?: string } = {}) {
    return [...this.visits.values()].filter((item) => {
      if (item.vendorId !== vendorId) return false;
      if (options.fromDate && item.date < options.fromDate) return false;
      if (options.toDate && item.date > options.toDate) return false;
      return true;
    });
  }

  async listVisitsByCommunity(communityId: string, options: {
    fromDate: string;
    toDate: string;
    vendorId?: string;
  }) {
    return [...this.visits.values()].filter((item) => {
      if (item.communityId !== communityId) return false;
      if (options.vendorId && item.vendorId !== options.vendorId) return false;
      if (item.date < options.fromDate || item.date > options.toDate) return false;
      return true;
    });
  }

  async getVisit(vendorId: string, visitId: string) {
    return this.visits.get(this.key(vendorId, visitId)) ?? null;
  }

  async saveVisit(record: DatedCommunityVisitRecord) {
    const key = this.key(record.vendorId, record.visitId);
    if (this.visits.has(key)) return 'exists' as const;
    this.visits.set(key, { ...record, assignedStaffIds: [...record.assignedStaffIds] });
    return 'created' as const;
  }

  async replaceVisit(record: DatedCommunityVisitRecord, expectedVersion: number) {
    const current = await this.getVisit(record.vendorId, record.visitId);
    if (!current || current.version !== expectedVersion) {
      throw new ConflictError('This visit was updated. Refresh and try again.');
    }
    this.visits.set(this.key(record.vendorId, record.visitId), { ...record, assignedStaffIds: [...record.assignedStaffIds] });
  }

  async getReservation(vendorId: string, visitId: string, bookingId: string) {
    return this.reservations.get(this.reservationKey(vendorId, visitId, bookingId)) ?? null;
  }

  async listReservations(vendorId: string, visitId: string) {
    return [...this.reservations.values()].filter((item) => item.vendorId === vendorId && item.visitId === visitId);
  }

  async reserve(input: { visit: DatedCommunityVisitRecord; bookingId: string; units: number; staffId?: string }) {
    const current = await this.requireCurrent(input.visit);
    const existing = await this.getReservation(current.vendorId, current.visitId, input.bookingId);
    if (existing?.status === 'booked') return current;
    if (current.bookedCount + current.heldCount + input.units > current.capacity || current.status !== 'scheduled') {
      throw new ConflictError('Visit capacity has been exceeded');
    }
    const next = { ...current, bookedCount: current.bookedCount + input.units, version: current.version + 1, updatedAt: new Date().toISOString() };
    this.visits.set(this.key(next.vendorId, next.visitId), next);
    this.reservations.set(this.reservationKey(next.vendorId, next.visitId, input.bookingId), {
      visitId: next.visitId,
      bookingId: input.bookingId,
      vendorId: next.vendorId,
      units: input.units,
      staffId: input.staffId,
      status: 'booked',
    });
    return next;
  }

  async release(input: { visit: DatedCommunityVisitRecord; bookingId: string }) {
    const current = await this.requireCurrent(input.visit);
    const existing = await this.getReservation(current.vendorId, current.visitId, input.bookingId);
    if (!existing || existing.status === 'released') return current;
    const next = {
      ...current,
      bookedCount: Math.max(0, current.bookedCount - existing.units),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.visits.set(this.key(next.vendorId, next.visitId), next);
    this.reservations.set(this.reservationKey(next.vendorId, next.visitId, input.bookingId), { ...existing, status: 'released' });
    return next;
  }

  async createHold(input: {
    visit: DatedCommunityVisitRecord;
    hold: CommunityVisitHoldRecord;
    idempotencyKey: string;
  }) {
    const idemKey = this.holdIdemKey(input.hold.customerId, input.idempotencyKey);
    const existingHoldId = this.holdIdempotency.get(idemKey);
    if (existingHoldId) {
      const existing = this.holds.get(existingHoldId);
      if (existing) return existing;
    }
    const current = await this.requireCurrent(input.visit);
    if (current.bookedCount + current.heldCount + input.hold.units > current.capacity || current.status !== 'scheduled') {
      throw new ConflictError('Visit capacity has been exceeded');
    }
    const next = {
      ...current,
      heldCount: current.heldCount + input.hold.units,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.visits.set(this.key(next.vendorId, next.visitId), next);
    this.holds.set(input.hold.holdId, { ...input.hold });
    this.holdIdempotency.set(idemKey, input.hold.holdId);
    return input.hold;
  }

  async getHold(holdId: string) {
    return this.holds.get(holdId) ?? null;
  }

  async getHoldByIdempotency(customerId: string, idempotencyKey: string) {
    const holdId = this.holdIdempotency.get(this.holdIdemKey(customerId, idempotencyKey));
    return holdId ? this.holds.get(holdId) ?? null : null;
  }

  async releaseHold(input: {
    visit: DatedCommunityVisitRecord;
    hold: CommunityVisitHoldRecord;
    nextStatus: 'released' | 'expired';
  }) {
    const currentHold = this.holds.get(input.hold.holdId);
    if (!currentHold) throw new ConflictError('Hold not found');
    if (currentHold.status !== HOLD_STATUS.ACTIVE) return currentHold;
    const current = await this.requireCurrent(input.visit);
    const next = {
      ...current,
      heldCount: Math.max(0, current.heldCount - currentHold.units),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.visits.set(this.key(next.vendorId, next.visitId), next);
    const released = { ...currentHold, status: input.nextStatus === 'expired' ? HOLD_STATUS.EXPIRED : HOLD_STATUS.RELEASED, updatedAt: next.updatedAt };
    this.holds.set(released.holdId, released);
    return released;
  }

  async confirmHold(input: {
    visit: DatedCommunityVisitRecord;
    hold: CommunityVisitHoldRecord;
    bookingId: string;
  }) {
    const currentHold = this.holds.get(input.hold.holdId);
    if (!currentHold) throw new ConflictError('Hold not found');
    if (currentHold.status === HOLD_STATUS.CONSUMED && currentHold.bookingId === input.bookingId) {
      const visit = await this.getVisit(input.visit.vendorId, input.visit.visitId);
      if (!visit) throw new ConflictError('Visit not found');
      return { visit, hold: currentHold };
    }
    if (currentHold.status !== HOLD_STATUS.ACTIVE) throw new ConflictError('Hold is not active');
    const current = await this.requireCurrent(input.visit);
    const next = {
      ...current,
      heldCount: Math.max(0, current.heldCount - currentHold.units),
      bookedCount: current.bookedCount + currentHold.units,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.visits.set(this.key(next.vendorId, next.visitId), next);
    this.reservations.set(this.reservationKey(next.vendorId, next.visitId, input.bookingId), {
      visitId: next.visitId,
      bookingId: input.bookingId,
      vendorId: next.vendorId,
      units: currentHold.units,
      status: 'booked',
    });
    const hold = {
      ...currentHold,
      status: HOLD_STATUS.CONSUMED,
      bookingId: input.bookingId,
      updatedAt: next.updatedAt,
    };
    this.holds.set(hold.holdId, hold);
    return { visit: next, hold };
  }

  async listExpiredHolds(expiresAtOrBefore: string, _hourBucket: string) {
    return [...this.holds.values()].filter(
      (hold) => hold.status === HOLD_STATUS.ACTIVE && hold.expiresAt <= expiresAtOrBefore,
    );
  }

  async getIdempotency(vendorId: string, key: string) {
    return this.idempotency.get(this.key(vendorId, key)) ?? null;
  }

  async saveIdempotency(vendorId: string, key: string, body: unknown) {
    const id = this.key(vendorId, key);
    if (!this.idempotency.has(id)) this.idempotency.set(id, body);
  }

  private async requireCurrent(visit: DatedCommunityVisitRecord) {
    const current = await this.getVisit(visit.vendorId, visit.visitId);
    if (!current || current.version !== visit.version) throw new ConflictError('This visit was updated. Refresh and try again.');
    return current;
  }

  private key(vendorId: string, id: string) {
    return `${vendorId}#${id}`;
  }

  private reservationKey(vendorId: string, visitId: string, bookingId: string) {
    return `${vendorId}#${visitId}#${bookingId}`;
  }

  private holdIdemKey(customerId: string, key: string) {
    return `${customerId}#${key}`;
  }
}

type ScheduleItem = CommunityVisitScheduleRecord & {
  PK: string;
  SK: string;
  entityType: 'CommunityVisitSchedule';
  GSI1PK?: string;
  GSI1SK?: string;
};
type VisitItem = DatedCommunityVisitRecord & {
  PK: string;
  SK: string;
  entityType: 'CommunityVisit';
  GSI1PK: string;
  GSI1SK: string;
};
type ReservationItem = VisitReservationRecord & { PK: string; SK: string; entityType: 'CommunityVisitReservation' };
type HoldItem = CommunityVisitHoldRecord & {
  PK: string;
  SK: string;
  entityType: 'CommunityVisitHold';
  GSI1PK?: string;
  GSI1SK?: string;
  ttl?: number;
};
type HoldLookupItem = CommunityVisitHoldRecord & {
  PK: string;
  SK: string;
  entityType: 'CommunityVisitHoldLookup';
  canonicalPk: string;
  canonicalSk: string;
  GSI1PK: string;
  GSI1SK: string;
};
type HoldIdempotencyItem = {
  PK: string;
  SK: string;
  entityType: 'CommunityVisitHoldIdempotency';
  holdId: string;
  customerId: string;
  idempotencyKey: string;
  createdAt: string;
};

export class DynamoCommunityVisitStore extends BaseRepository implements CommunityVisitStore {
  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async listSchedules(vendorId: string) {
    const items = await this.queryAll<ScheduleItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': this.pk(vendorId), ':prefix': 'CVISIT_SCHEDULE#' },
    });
    return items.map((item) => withActive(strip(item)));
  }

  async getSchedule(vendorId: string, scheduleId: string) {
    const item = await this.get<ScheduleItem>(this.getTableName(), {
      PK: this.pk(vendorId),
      SK: AvailabilityKeyBuilder.vendorCommunityScheduleSk(scheduleId),
    });
    return item ? withActive(strip(item)) : null;
  }

  async saveSchedule(record: CommunityVisitScheduleRecord) {
    await this.put(this.getTableName(), this.scheduleItem(withActive(record)));
  }

  async listVisits(vendorId: string, options: { fromDate?: string; toDate?: string } = {}) {
    const values: Record<string, string> = { ':pk': this.pk(vendorId) };
    let keyCondition = 'PK = :pk AND begins_with(SK, :prefix)';
    if (options.fromDate && options.toDate) {
      keyCondition = 'PK = :pk AND SK BETWEEN :from AND :to';
      values[':from'] = AvailabilityKeyBuilder.vendorCommunityVisitSkFrom(options.fromDate);
      values[':to'] = `${AvailabilityKeyBuilder.vendorCommunityVisitSkFrom(options.toDate)}\uffff`;
    } else {
      values[':prefix'] = 'CVISIT#';
    }
    const items = await this.queryAll<VisitItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: values,
    });
    return items
      .map((item) => strip(item))
      .filter((item) => {
        // SK prefix CVISIT# also matches nothing else with '#', but keep date filters authoritative.
        if (!item.visitId || !item.date) return false;
        if (options.fromDate && item.date < options.fromDate) return false;
        if (options.toDate && item.date > options.toDate) return false;
        return true;
      });
  }

  async listVisitsByCommunity(communityId: string, options: {
    fromDate: string;
    toDate: string;
    vendorId?: string;
  }) {
    const items = await this.queryAll<VisitItem>({
      TableName: this.getTableName(),
      IndexName: GSI1_INDEX,
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :from AND :to',
      ExpressionAttributeValues: {
        ':pk': AvailabilityKeyBuilder.communityPk(communityId),
        ':from': AvailabilityKeyBuilder.communityVisitSkFrom(options.fromDate),
        ':to': `${AvailabilityKeyBuilder.communityVisitSkFrom(options.toDate)}\uffff`,
      },
    });
    return items
      .map((item) => strip(item))
      .filter((item) => {
        if (item.date < options.fromDate || item.date > options.toDate) return false;
        if (options.vendorId && item.vendorId !== options.vendorId) return false;
        return true;
      });
  }

  async getVisit(vendorId: string, visitId: string) {
    const items = await this.queryAll<VisitItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      FilterExpression: 'visitId = :visitId',
      ExpressionAttributeValues: { ':pk': this.pk(vendorId), ':prefix': 'CVISIT#', ':visitId': visitId },
    });
    return items[0] ? strip(items[0]) : null;
  }

  async saveVisit(record: DatedCommunityVisitRecord) {
    try {
      await this.put(this.getTableName(), this.visitItem(record), 'attribute_not_exists(PK)');
      return 'created' as const;
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) return 'exists' as const;
      throw error;
    }
  }

  async replaceVisit(record: DatedCommunityVisitRecord, expectedVersion: number) {
    await this.transactWrite({
      TransactItems: [{
        Put: {
          TableName: this.getTableName(),
          Item: this.visitItem(record),
          ConditionExpression: 'attribute_exists(PK) AND version = :expected',
          ExpressionAttributeValues: { ':expected': expectedVersion },
        },
      }],
    });
  }

  async getReservation(vendorId: string, visitId: string, bookingId: string) {
    const item = await this.get<ReservationItem>(this.getTableName(), { PK: this.pk(vendorId), SK: this.reservationSk(visitId, bookingId) });
    return item ? strip(item) : null;
  }

  async listReservations(vendorId: string, visitId: string) {
    const items = await this.queryAll<ReservationItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': this.pk(vendorId), ':prefix': `CVISIT_RESERVATION#${visitId}#` },
    });
    return items.map(strip);
  }

  async reserve(input: { visit: DatedCommunityVisitRecord; bookingId: string; units: number; staffId?: string }) {
    const existing = await this.getReservation(input.visit.vendorId, input.visit.visitId, input.bookingId);
    if (existing?.status === 'booked') {
      const current = await this.getVisit(input.visit.vendorId, input.visit.visitId);
      if (!current) throw new ConflictError('Visit not found');
      return current;
    }
    const next = { ...input.visit, bookedCount: input.visit.bookedCount + input.units, version: input.visit.version + 1, updatedAt: new Date().toISOString() };
    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: this.getTableName(),
              Item: this.visitItem(next),
              ConditionExpression: 'attribute_exists(PK) AND version = :expected AND #status = :scheduled AND bookedCount = :booked AND heldCount = :held AND capacity >= :needed',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':expected': input.visit.version,
                ':scheduled': 'scheduled',
                ':booked': input.visit.bookedCount,
                ':held': input.visit.heldCount,
                ':needed': input.visit.bookedCount + input.visit.heldCount + input.units,
              },
            },
          },
          {
            Put: {
              TableName: this.getTableName(),
              Item: {
                ...this.reservationItem({
                  visitId: next.visitId,
                  bookingId: input.bookingId,
                  vendorId: next.vendorId,
                  units: input.units,
                  staffId: input.staffId,
                  status: 'booked',
                }),
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) throw new ConflictError('Visit capacity has been exceeded');
      throw error;
    }
    return next;
  }

  async release(input: { visit: DatedCommunityVisitRecord; bookingId: string }) {
    const existing = await this.getReservation(input.visit.vendorId, input.visit.visitId, input.bookingId);
    if (!existing || existing.status === 'released') {
      const current = await this.getVisit(input.visit.vendorId, input.visit.visitId);
      if (!current) throw new ConflictError('Visit not found');
      return current;
    }
    const next = {
      ...input.visit,
      bookedCount: Math.max(0, input.visit.bookedCount - existing.units),
      version: input.visit.version + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: this.visitItem(next),
            ConditionExpression: 'attribute_exists(PK) AND version = :expected AND bookedCount = :booked',
            ExpressionAttributeValues: { ':expected': input.visit.version, ':booked': input.visit.bookedCount },
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: this.reservationItem({ ...existing, status: 'released' }),
          },
        },
      ],
    });
    return next;
  }

  async createHold(input: {
    visit: DatedCommunityVisitRecord;
    hold: CommunityVisitHoldRecord;
    idempotencyKey: string;
  }) {
    const replay = await this.getHoldByIdempotency(input.hold.customerId, input.idempotencyKey);
    if (replay) return replay;
    const next = {
      ...input.visit,
      heldCount: input.visit.heldCount + input.hold.units,
      version: input.visit.version + 1,
      updatedAt: new Date().toISOString(),
    };
    const holdItem = this.holdItem(input.hold);
    const lookup = this.holdLookupItem(input.hold, holdItem.PK, holdItem.SK);
    const idempotency = this.holdIdempotencyItem(input.hold, input.idempotencyKey);
    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: this.getTableName(),
              Item: idempotency,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: this.getTableName(),
              Item: this.visitItem(next),
              ConditionExpression: 'attribute_exists(PK) AND version = :expected AND #status = :scheduled AND bookedCount = :booked AND heldCount = :held AND capacity >= :needed',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':expected': input.visit.version,
                ':scheduled': 'scheduled',
                ':booked': input.visit.bookedCount,
                ':held': input.visit.heldCount,
                ':needed': input.visit.bookedCount + input.visit.heldCount + input.hold.units,
              },
            },
          },
          {
            Put: {
              TableName: this.getTableName(),
              Item: holdItem,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: this.getTableName(),
              Item: lookup,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        const again = await this.getHoldByIdempotency(input.hold.customerId, input.idempotencyKey);
        if (again) return again;
        throw new ConflictError('Visit capacity has been exceeded');
      }
      throw error;
    }
    return input.hold;
  }

  async getHold(holdId: string) {
    const lookup = await this.get<HoldLookupItem>(this.getTableName(), {
      PK: AvailabilityKeyBuilder.holdLookupPk(holdId),
      SK: 'META',
    });
    if (!lookup || lookup.entityType !== 'CommunityVisitHoldLookup') return null;
    const item = await this.get<HoldItem>(this.getTableName(), { PK: lookup.canonicalPk, SK: lookup.canonicalSk });
    return item ? stripHold(item) : stripHold(lookup);
  }

  async getHoldByIdempotency(customerId: string, idempotencyKey: string) {
    const item = await this.get<HoldIdempotencyItem>(this.getTableName(), {
      PK: `IDEMPOTENCY#CVISIT_HOLD#${customerId}#${idempotencyKey}`,
      SK: 'META',
    });
    if (!item?.holdId) return null;
    return this.getHold(item.holdId);
  }

  async releaseHold(input: {
    visit: DatedCommunityVisitRecord;
    hold: CommunityVisitHoldRecord;
    nextStatus: 'released' | 'expired';
  }) {
    const current = await this.getHold(input.hold.holdId);
    if (!current) throw new ConflictError('Hold not found');
    if (current.status !== HOLD_STATUS.ACTIVE) return current;
    const nextStatus = input.nextStatus === 'expired' ? HOLD_STATUS.EXPIRED : HOLD_STATUS.RELEASED;
    const nextVisit = {
      ...input.visit,
      heldCount: Math.max(0, input.visit.heldCount - current.units),
      version: input.visit.version + 1,
      updatedAt: new Date().toISOString(),
    };
    const nextHold = { ...current, status: nextStatus, updatedAt: nextVisit.updatedAt };
    const holdItem = this.holdItem(nextHold);
    delete holdItem.GSI1PK;
    delete holdItem.GSI1SK;
    const lookup = this.holdLookupItem(nextHold, holdItem.PK, holdItem.SK);
    delete (lookup as { GSI1PK?: string }).GSI1PK;
    delete (lookup as { GSI1SK?: string }).GSI1SK;
    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: this.getTableName(),
              Item: this.visitItem(nextVisit),
              ConditionExpression: 'attribute_exists(PK) AND version = :expected AND heldCount = :held',
              ExpressionAttributeValues: { ':expected': input.visit.version, ':held': input.visit.heldCount },
            },
          },
          {
            Put: {
              TableName: this.getTableName(),
              Item: holdItem,
              ConditionExpression: 'attribute_exists(PK) AND #status = :active',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: { ':active': HOLD_STATUS.ACTIVE },
            },
          },
          {
            Put: {
              TableName: this.getTableName(),
              Item: lookup,
            },
          },
        ],
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        const again = await this.getHold(input.hold.holdId);
        if (again && again.status !== HOLD_STATUS.ACTIVE) return again;
        throw new ConflictError('Hold could not be released');
      }
      throw error;
    }
    return nextHold;
  }

  async confirmHold(input: {
    visit: DatedCommunityVisitRecord;
    hold: CommunityVisitHoldRecord;
    bookingId: string;
  }) {
    const current = await this.getHold(input.hold.holdId);
    if (!current) throw new ConflictError('Hold not found');
    if (current.status === HOLD_STATUS.CONSUMED && current.bookingId === input.bookingId) {
      const visit = await this.getVisit(input.visit.vendorId, input.visit.visitId);
      if (!visit) throw new ConflictError('Visit not found');
      return { visit, hold: current };
    }
    if (current.status !== HOLD_STATUS.ACTIVE) throw new ConflictError('Hold is not active');
    const nextVisit = {
      ...input.visit,
      heldCount: Math.max(0, input.visit.heldCount - current.units),
      bookedCount: input.visit.bookedCount + current.units,
      version: input.visit.version + 1,
      updatedAt: new Date().toISOString(),
    };
    const nextHold = {
      ...current,
      status: HOLD_STATUS.CONSUMED,
      bookingId: input.bookingId,
      updatedAt: nextVisit.updatedAt,
    };
    const holdItem = this.holdItem(nextHold);
    delete holdItem.GSI1PK;
    delete holdItem.GSI1SK;
    const lookup = this.holdLookupItem(nextHold, holdItem.PK, holdItem.SK);
    delete (lookup as { GSI1PK?: string }).GSI1PK;
    delete (lookup as { GSI1SK?: string }).GSI1SK;
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: this.visitItem(nextVisit),
            ConditionExpression: 'attribute_exists(PK) AND version = :expected AND heldCount = :held AND bookedCount = :booked',
            ExpressionAttributeValues: {
              ':expected': input.visit.version,
              ':held': input.visit.heldCount,
              ':booked': input.visit.bookedCount,
            },
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: holdItem,
            ConditionExpression: 'attribute_exists(PK) AND #status = :active',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':active': HOLD_STATUS.ACTIVE },
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: lookup,
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: this.reservationItem({
              visitId: nextVisit.visitId,
              bookingId: input.bookingId,
              vendorId: nextVisit.vendorId,
              units: current.units,
              status: 'booked',
            }),
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ],
    });
    return { visit: nextVisit, hold: nextHold };
  }

  async listExpiredHolds(expiresAtOrBefore: string, hourBucket: string) {
    const items = await this.queryAll<HoldItem>({
      TableName: this.getTableName(),
      IndexName: GSI1_INDEX,
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': AvailabilityKeyBuilder.holdExpiryPk(hourBucket),
        ':prefix': 'HOLD#',
      },
    });
    return items
      .filter((item) => item.entityType === 'CommunityVisitHold' && item.status === HOLD_STATUS.ACTIVE && item.expiresAt <= expiresAtOrBefore)
      .map(stripHold);
  }

  async getIdempotency(vendorId: string, key: string) {
    const item = await this.get<{ body?: unknown }>(this.getTableName(), { PK: this.pk(vendorId), SK: `CVISIT_IDEMPOTENCY#${key}` });
    return item?.body ?? null;
  }

  async saveIdempotency(vendorId: string, key: string, body: unknown) {
    try {
      await this.put(this.getTableName(), {
        PK: this.pk(vendorId),
        SK: `CVISIT_IDEMPOTENCY#${key}`,
        entityType: 'CommunityVisitIdempotency',
        body,
      }, 'attribute_not_exists(PK)');
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError)) throw error;
    }
  }

  private pk(vendorId: string) {
    return AvailabilityKeyBuilder.vendorCommunityVisitPk(vendorId);
  }

  private reservationSk(visitId: string, bookingId: string) {
    return `CVISIT_RESERVATION#${visitId}#${bookingId}`;
  }

  private scheduleItem(record: CommunityVisitScheduleRecord): ScheduleItem {
    return {
      ...record,
      PK: this.pk(record.vendorId),
      SK: AvailabilityKeyBuilder.vendorCommunityScheduleSk(record.scheduleId),
      entityType: 'CommunityVisitSchedule',
      GSI1PK: AvailabilityKeyBuilder.communityPk(record.communityId),
      GSI1SK: AvailabilityKeyBuilder.communityScheduleSk(record.vendorId, record.scheduleId),
    };
  }

  private visitItem(record: DatedCommunityVisitRecord): VisitItem {
    return {
      ...record,
      PK: this.pk(record.vendorId),
      SK: AvailabilityKeyBuilder.vendorCommunityVisitSk(record.date, record.visitId),
      entityType: 'CommunityVisit',
      GSI1PK: AvailabilityKeyBuilder.communityPk(record.communityId),
      GSI1SK: AvailabilityKeyBuilder.communityVisitSk(record.date, record.vendorId, record.visitId),
    };
  }

  private reservationItem(record: VisitReservationRecord): ReservationItem {
    return { ...record, PK: this.pk(record.vendorId), SK: this.reservationSk(record.visitId, record.bookingId), entityType: 'CommunityVisitReservation' };
  }

  private holdItem(record: CommunityVisitHoldRecord): HoldItem {
    const item: HoldItem = {
      ...record,
      PK: this.pk(record.vendorId),
      SK: AvailabilityKeyBuilder.communityVisitHoldSk(record.visitId, record.holdId),
      entityType: 'CommunityVisitHold',
    };
    if (record.status === HOLD_STATUS.ACTIVE) {
      item.GSI1PK = AvailabilityKeyBuilder.holdExpiryPk(expiryHourBucket(record.expiresAt));
      item.GSI1SK = AvailabilityKeyBuilder.holdExpirySk(record.expiresAt, record.holdId);
      item.ttl = Math.floor(Date.parse(record.expiresAt) / 1000) + 7 * 24 * 60 * 60;
    }
    return item;
  }

  private holdLookupItem(record: CommunityVisitHoldRecord, canonicalPk: string, canonicalSk: string): HoldLookupItem {
    return {
      ...record,
      PK: AvailabilityKeyBuilder.holdLookupPk(record.holdId),
      SK: 'META',
      entityType: 'CommunityVisitHoldLookup',
      canonicalPk,
      canonicalSk,
      GSI1PK: AvailabilityKeyBuilder.customerHoldPk(record.customerId),
      GSI1SK: AvailabilityKeyBuilder.customerHoldSk(record.createdAt, record.holdId),
    };
  }

  private holdIdempotencyItem(record: CommunityVisitHoldRecord, idempotencyKey: string): HoldIdempotencyItem {
    return {
      PK: `IDEMPOTENCY#CVISIT_HOLD#${record.customerId}#${idempotencyKey}`,
      SK: 'META',
      entityType: 'CommunityVisitHoldIdempotency',
      holdId: record.holdId,
      customerId: record.customerId,
      idempotencyKey,
      createdAt: record.createdAt,
    };
  }
}

function withActive(record: CommunityVisitScheduleRecord): CommunityVisitScheduleRecord {
  return { ...record, active: record.active !== false };
}

function stripHold<T extends { PK?: string; SK?: string; entityType?: string; GSI1PK?: string; GSI1SK?: string; canonicalPk?: string; canonicalSk?: string; ttl?: number }>(
  item: T,
): CommunityVisitHoldRecord {
  const record = { ...item } as Record<string, unknown>;
  delete record.PK;
  delete record.SK;
  delete record.entityType;
  delete record.GSI1PK;
  delete record.GSI1SK;
  delete record.canonicalPk;
  delete record.canonicalSk;
  delete record.ttl;
  return record as unknown as CommunityVisitHoldRecord;
}

function strip<T extends { PK?: string; SK?: string; entityType?: string; GSI1PK?: string; GSI1SK?: string }>(
  item: T,
): Omit<T, 'PK' | 'SK' | 'entityType' | 'GSI1PK' | 'GSI1SK'> {
  const record = { ...item } as Record<string, unknown>;
  delete record.PK;
  delete record.SK;
  delete record.entityType;
  delete record.GSI1PK;
  delete record.GSI1SK;
  return record as Omit<T, 'PK' | 'SK' | 'entityType' | 'GSI1PK' | 'GSI1SK'>;
}
