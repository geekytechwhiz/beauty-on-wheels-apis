import { ValidationError } from '@api-hub/utils';

import { BookingError } from '../errors';
import { PlanVisitWindow } from '../types/customer-plan.types';
import {
  PACKAGE_VISIT_STATUS,
  PackageVisitRecord,
  PackageVisitStatus,
} from '../types/package-visit.types';
import {
  OPERATIONS_TIMEZONE,
  addCalendarDays,
  calendarDateInTimeZone,
  eachDate,
  inclusiveDayCount,
} from './vendor-package-visits';

/** Planning gap between communities. Not a driving-time estimate. */
export const DEFAULT_TRAVEL_BUFFER_MINUTES = 30;
/** One TransactWrite covers the whole request. Larger groups are rejected. */
export const MAX_ASSIGNMENT_VISITS = 25;
export const MAX_ASSIGNMENT_DAYS = 14;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

const OCCUPYING_STATUSES: readonly PackageVisitStatus[] = [
  PACKAGE_VISIT_STATUS.SCHEDULED,
  PACKAGE_VISIT_STATUS.IN_PROGRESS,
];

const SCHEDULE_STATUSES: readonly PackageVisitStatus[] = [
  PACKAGE_VISIT_STATUS.SCHEDULED,
  PACKAGE_VISIT_STATUS.IN_PROGRESS,
  PACKAGE_VISIT_STATUS.COMPLETED,
  PACKAGE_VISIT_STATUS.MISSED,
];

export interface SchedulingCrewMember {
  staffId: string;
  status: string;
  name?: string;
}

export interface SchedulingCrew {
  crewId: string;
  vendorId: string;
  name: string;
  vanLabel: string;
  status: string;
  staff: SchedulingCrewMember[];
}

export interface WindowInterval {
  known: boolean;
  allDay: boolean;
  startMinute?: number;
  endMinute?: number;
  startTime?: string;
  endTime?: string;
}

export interface AssignmentCommand {
  mode: 'assign' | 'unassign';
  scheduledDate: string;
  communityId: string;
  visitWindowId: string;
  crewId: string;
  visitIds: string[];
  replaceExisting: boolean;
}

export interface Workload {
  durationKnown: boolean;
  estimatedMinutes?: number;
  unknownDurationCount: number;
  capacityKnown: boolean;
  availableMinutes?: number;
  utilizationPercent?: number;
  overloaded?: boolean;
}

export interface TravelWarning {
  crewId: string;
  fromDate: string;
  toDate: string;
  fromCommunityId: string;
  toCommunityId: string;
  fromVisitWindowId: string;
  toVisitWindowId: string;
  requiredMinutes: number;
  verified: boolean;
  gapMinutes?: number;
  message: string;
}

export interface AssignmentConflict {
  code: string;
  message: string;
  crewId?: string;
  staffId?: string;
}

export interface AssignmentVisitView {
  visitId: string;
  planId: string;
  status: PackageVisitStatus;
  registrationNumber?: string;
  vehicleDisplayName?: string;
  serviceName: string;
  durationMinutes?: number;
  durationKnown: boolean;
  crewId?: string;
}

export interface AssignmentCrewGroup {
  crewId: string;
  crewName?: string;
  vanLabel?: string;
  staff: SchedulingCrewMember[];
  staffIds: string[];
  activeStaffCount: number;
  visitCount: number;
  visits: AssignmentVisitView[];
  workload: Workload;
}

export interface AssignmentCommunityGroup {
  communityId: string;
  visitWindowId: string;
  visitWindowName?: string;
  windowStart?: string;
  windowEnd?: string;
  allDay: boolean;
  windowTimesKnown: boolean;
  availableMinutes?: number;
  scheduledCount: number;
  assignedCount: number;
  unassignedCount: number;
  unassignedVisits: AssignmentVisitView[];
  crews: AssignmentCrewGroup[];
}

export interface AssignmentDay {
  date: string;
  scheduledCount: number;
  assignedCount: number;
  unassignedCount: number;
  groups: AssignmentCommunityGroup[];
  travelWarnings: TravelWarning[];
  conflicts: AssignmentConflict[];
}

export interface AssignmentSchedule {
  timezone: typeof OPERATIONS_TIMEZONE;
  fromDate: string;
  toDate: string;
  travelBufferMinutes: number;
  /**
   * Crew.vanLabel is a display string. The vendor record has no stable van id,
   * so assignments do not claim vehicle isolation.
   */
  vanIdentity: 'displayLabelOnly';
  days: AssignmentDay[];
}

export interface AssignmentWriteResult {
  scheduledDate: string;
  communityId: string;
  visitWindowId: string;
  crewId: string;
  visitIds: string[];
  idempotent: boolean;
  workload: Workload;
  travelWarnings: TravelWarning[];
  /** True only when both durations are known and the window is overloaded. */
  capacityAdvisory: boolean;
}

interface OccupiedSlot {
  date: string;
  communityId: string;
  visitWindowId: string;
  crewId: string;
  staffIds: string[];
  interval: WindowInterval;
  crewRecordMissing?: boolean;
}

export function activeStaff(crew: SchedulingCrew): SchedulingCrewMember[] {
  const seen = new Set<string>();
  return crew.staff.filter((member) => {
    if (member.status !== 'ACTIVE' || !member.staffId || seen.has(member.staffId)) return false;
    seen.add(member.staffId);
    return true;
  });
}

export function assertCrewAssignable(crew: SchedulingCrew): string[] {
  if (crew.status !== 'ACTIVE') {
    throw conflict('CREW_INACTIVE', 'This crew is not active');
  }
  const staffIds = activeStaff(crew).map((member) => member.staffId);
  if (staffIds.length < 2) {
    throw conflict('CREW_TOO_SMALL', 'A crew needs at least two active staff members');
  }
  return staffIds;
}

export function parseAssignmentCommand(body: unknown): AssignmentCommand {
  const record = asRecord(body);
  const mode = record.mode === undefined || record.mode === 'assign'
    ? 'assign'
    : record.mode === 'unassign'
      ? 'unassign'
      : undefined;
  if (!mode) throw new ValidationError('mode must be assign or unassign');
  const scheduledDate = requireDate(record.scheduledDate, 'scheduledDate');
  const communityId = requireId(record.communityId, 'communityId');
  const visitWindowId = requireId(record.visitWindowId, 'visitWindowId');
  const crewId = requireId(record.crewId, 'crewId');
  const visitIds = requireVisitIds(record.visitIds);
  const replaceExisting = record.replaceExisting === undefined ? false : record.replaceExisting;
  if (typeof replaceExisting !== 'boolean') {
    throw new ValidationError('replaceExisting must be a boolean');
  }
  return {
    mode,
    scheduledDate,
    communityId,
    visitWindowId,
    crewId,
    visitIds,
    replaceExisting: mode === 'assign' ? replaceExisting : false,
  };
}

export function parseAssignmentRange(
  query: Record<string, string | undefined> | null | undefined,
  now: Date,
): { fromDate: string; toDate: string } {
  const source = query ?? {};
  const today = calendarDateInTimeZone(now);
  const fromDate = source.fromDate?.trim() ? requireDate(source.fromDate, 'fromDate') : today;
  const toDate = source.toDate?.trim() ? requireDate(source.toDate, 'toDate') : addCalendarDays(fromDate, 2);
  if (fromDate > toDate) throw new ValidationError('fromDate must be on or before toDate');
  if (inclusiveDayCount(fromDate, toDate) > MAX_ASSIGNMENT_DAYS) {
    throw new ValidationError(`Date range cannot exceed ${MAX_ASSIGNMENT_DAYS} days`);
  }
  return { fromDate, toDate };
}

export function windowInterval(window: PlanVisitWindow | undefined, visitWindowId: string): WindowInterval {
  if (!window || window.visitWindowId !== visitWindowId) return { known: false, allDay: false };
  if (window.allDay === true) {
    return { known: true, allDay: true, startMinute: 0, endMinute: 24 * 60, startTime: '00:00', endTime: '24:00' };
  }
  const startMinute = minutesOf(window.startTime);
  const endMinute = minutesOf(window.endTime);
  if (startMinute === undefined || endMinute === undefined || endMinute <= startMinute) {
    return { known: false, allDay: false };
  }
  return {
    known: true,
    allDay: false,
    startMinute,
    endMinute,
    startTime: window.startTime,
    endTime: window.endTime,
  };
}

export function consensusInterval(intervals: WindowInterval[]): WindowInterval {
  if (intervals.length === 0) return { known: false, allDay: false };
  const first = intervals[0];
  const same = intervals.every((interval) => (
    interval.known === first.known
    && interval.allDay === first.allDay
    && interval.startMinute === first.startMinute
    && interval.endMinute === first.endMinute
  ));
  return same ? first : { known: false, allDay: false };
}

export function durationKnown(minutes: number | undefined): minutes is number {
  return typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 1;
}

export function workloadFor(durations: Array<number | undefined>, interval: WindowInterval): Workload {
  const unknownDurationCount = durations.filter((minutes) => !durationKnown(minutes)).length;
  const durationKnownAll = unknownDurationCount === 0;
  const estimatedMinutes = durationKnownAll
    ? durations.reduce<number>((sum, minutes) => sum + (minutes ?? 0), 0)
    : undefined;
  const availableMinutes = interval.known && interval.startMinute !== undefined && interval.endMinute !== undefined
    ? interval.endMinute - interval.startMinute
    : undefined;
  const capacityKnown = durationKnownAll && availableMinutes !== undefined;
  const utilizationPercent = capacityKnown && availableMinutes > 0
    ? Math.round((estimatedMinutes! / availableMinutes) * 100)
    : undefined;
  return {
    durationKnown: durationKnownAll,
    ...(estimatedMinutes !== undefined ? { estimatedMinutes } : {}),
    unknownDurationCount,
    capacityKnown,
    ...(availableMinutes !== undefined ? { availableMinutes } : {}),
    ...(utilizationPercent !== undefined ? { utilizationPercent } : {}),
    ...(capacityKnown ? { overloaded: estimatedMinutes! > availableMinutes! } : {}),
  };
}

export function visitEligible(visit: PackageVisitRecord, command: AssignmentCommand, vendorId: string): void {
  if (visit.vendorId !== vendorId) {
    throw conflict('CROSS_VENDOR_VISIT', 'Visit belongs to a different vendor', 'visitId');
  }
  if (visit.status === PACKAGE_VISIT_STATUS.UNSCHEDULED || !visit.schedule) {
    throw conflict('VISIT_NOT_ASSIGNABLE', 'Unscheduled visits cannot be assigned', 'visitId');
  }
  if (visit.status !== PACKAGE_VISIT_STATUS.SCHEDULED) {
    throw conflict('VISIT_NOT_ASSIGNABLE', `A ${visit.status} visit cannot be assigned`, 'visitId');
  }
  if (visit.schedule.date !== command.scheduledDate) {
    throw conflict('VISIT_NOT_ASSIGNABLE', 'Visit is not scheduled on the requested date', 'scheduledDate');
  }
  if (visit.communityId !== command.communityId) {
    throw conflict('VISIT_NOT_ASSIGNABLE', 'Visit is not in the requested community', 'communityId');
  }
  if (visit.visitWindowId !== command.visitWindowId) {
    throw conflict('VISIT_NOT_ASSIGNABLE', 'Visit is not in the requested visit window', 'visitWindowId');
  }
}

export function assignmentConflicts(input: {
  target: OccupiedSlot;
  others: OccupiedSlot[];
}): AssignmentConflict[] {
  const conflicts: AssignmentConflict[] = [];
  for (const other of input.others) {
    if (sameSlot(input.target, other) && other.crewId === input.target.crewId) continue;
    if (other.date !== input.target.date) continue;
    const sameCrew = other.crewId === input.target.crewId;
    const sharedStaff = input.target.staffIds.filter((staffId) => other.staffIds.includes(staffId));
    if (!sameCrew && sharedStaff.length === 0 && !other.crewRecordMissing) continue;
    const relation = intervalsConflict(input.target.interval, other.interval);
    if (relation === 'clear') continue;
    if (relation === 'unknown') {
      conflicts.push({
        code: 'WINDOW_TIMES_UNKNOWN',
        crewId: input.target.crewId,
        message: 'Visit window times are missing, so overlapping crew or staff assignments cannot be ruled out',
      });
      continue;
    }
    if (sameCrew) {
      conflicts.push({
        code: 'CREW_WINDOW_OVERLAP',
        crewId: input.target.crewId,
        message: 'This crew is already assigned to an overlapping community window',
      });
    }
    for (const staffId of sharedStaff) {
      conflicts.push({
        code: 'STAFF_WINDOW_OVERLAP',
        crewId: input.target.crewId,
        staffId,
        message: `Staff member ${staffId} is already assigned to an overlapping window`,
      });
    }
    if (!sameCrew && sharedStaff.length === 0 && other.crewRecordMissing) {
      conflicts.push({
        code: 'STAFF_OVERLAP_UNVERIFIED',
        crewId: other.crewId,
        message: 'An overlapping assignment uses a crew that is no longer on this vendor, so staff overlap cannot be verified',
      });
    }
  }
  return dedupeConflicts(conflicts);
}

export function travelWarningsFor(
  slots: OccupiedSlot[],
  bufferMinutes: number,
): TravelWarning[] {
  const byCrew = new Map<string, OccupiedSlot[]>();
  for (const slot of slots) {
    const list = byCrew.get(slot.crewId) ?? [];
    list.push(slot);
    byCrew.set(slot.crewId, list);
  }
  const warnings: TravelWarning[] = [];
  for (const [crewId, crewSlots] of byCrew) {
    const ordered = [...crewSlots].sort(compareSlots);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const next = ordered[index];
      if (previous.communityId === next.communityId) continue;
      if (!previous.interval.known || !next.interval.known
        || previous.interval.endMinute === undefined || next.interval.startMinute === undefined) {
        warnings.push({
          crewId,
          fromDate: previous.date,
          toDate: next.date,
          fromCommunityId: previous.communityId,
          toCommunityId: next.communityId,
          fromVisitWindowId: previous.visitWindowId,
          toVisitWindowId: next.visitWindowId,
          requiredMinutes: bufferMinutes,
          verified: false,
          message: 'Travel feasibility cannot be verified because visit window times are missing',
        });
        continue;
      }
      const gap = absoluteMinute(next.date, next.interval.startMinute, previous.date) - previous.interval.endMinute;
      if (gap >= bufferMinutes) continue;
      warnings.push({
        crewId,
        fromDate: previous.date,
        toDate: next.date,
        fromCommunityId: previous.communityId,
        toCommunityId: next.communityId,
        fromVisitWindowId: previous.visitWindowId,
        toVisitWindowId: next.visitWindowId,
        requiredMinutes: bufferMinutes,
        verified: true,
        gapMinutes: gap,
        message: `Only ${gap} minutes between communities. The planning buffer is ${bufferMinutes} minutes`,
      });
    }
  }
  return warnings;
}

export function buildAssignmentSchedule(input: {
  fromDate: string;
  toDate: string;
  travelBufferMinutes: number;
  visits: PackageVisitRecord[];
  intervals: Map<string, WindowInterval>;
  crews: SchedulingCrew[];
}): AssignmentSchedule {
  const crewById = new Map(input.crews.map((crew) => [crew.crewId, crew]));
  const days = eachDate(input.fromDate, input.toDate).map((date) => {
    const dayVisits = input.visits.filter((visit) => (
      visit.schedule?.date === date && SCHEDULE_STATUSES.includes(visit.status)
    ));
    const groups = groupVisits(dayVisits, input.intervals, crewById);
    const occupied = occupiedSlots(dayVisits, input.intervals, crewById);
    const conflicts = conflictsAmong(occupied);
    return {
      date,
      scheduledCount: dayVisits.length,
      assignedCount: dayVisits.filter((visit) => Boolean(visit.crewAssignment)).length,
      unassignedCount: dayVisits.filter((visit) => (
        visit.status === PACKAGE_VISIT_STATUS.SCHEDULED && !visit.crewAssignment
      )).length,
      groups,
      travelWarnings: travelWarningsFor(occupied, input.travelBufferMinutes)
        .filter((warning) => warning.toDate === date || warning.fromDate === date),
      conflicts,
    };
  });
  return {
    timezone: OPERATIONS_TIMEZONE,
    fromDate: input.fromDate,
    toDate: input.toDate,
    travelBufferMinutes: input.travelBufferMinutes,
    vanIdentity: 'displayLabelOnly',
    days,
  };
}

export function assignVisit(
  visit: PackageVisitRecord,
  crewId: string,
  actorId: string,
  now: string,
): PackageVisitRecord {
  return {
    ...visit,
    crewAssignment: {
      crewId,
      assignedAt: now,
      assignedBy: actorId,
    },
    updatedAt: now,
    version: visit.version + 1,
  };
}

export function sameAssignment(visit: PackageVisitRecord, crewId: string): boolean {
  return visit.crewAssignment?.crewId === crewId;
}

export function occupiedFromVisits(
  visits: PackageVisitRecord[],
  intervals: Map<string, WindowInterval>,
  crews: SchedulingCrew[],
): OccupiedSlot[] {
  return occupiedSlots(visits, intervals, new Map(crews.map((crew) => [crew.crewId, crew])));
}

function groupVisits(
  visits: PackageVisitRecord[],
  intervals: Map<string, WindowInterval>,
  crews: Map<string, SchedulingCrew>,
): AssignmentCommunityGroup[] {
  const buckets = new Map<string, PackageVisitRecord[]>();
  for (const visit of visits) {
    const communityId = visit.communityId ?? '';
    const visitWindowId = visit.visitWindowId ?? '';
    const key = `${communityId}\u0000${visitWindowId}`;
    const list = buckets.get(key) ?? [];
    list.push(visit);
    buckets.set(key, list);
  }
  return [...buckets.entries()].map(([, group]) => {
    const sample = group[0];
    const communityId = sample.communityId ?? '';
    const visitWindowId = sample.visitWindowId ?? '';
    const interval = consensusInterval(group.map((visit) => intervals.get(visit.visitId) ?? { known: false, allDay: false }));
    const crewBuckets = new Map<string, PackageVisitRecord[]>();
    const unassigned = group.filter((visit) => visit.status === PACKAGE_VISIT_STATUS.SCHEDULED && !visit.crewAssignment);
    for (const visit of group) {
      const crewId = visit.crewAssignment?.crewId;
      if (!crewId) continue;
      const list = crewBuckets.get(crewId) ?? [];
      list.push(visit);
      crewBuckets.set(crewId, list);
    }
    const workloadVisits = (items: PackageVisitRecord[]) => items.filter((visit) => (
      visit.status === PACKAGE_VISIT_STATUS.SCHEDULED
      || visit.status === PACKAGE_VISIT_STATUS.IN_PROGRESS
      || visit.status === PACKAGE_VISIT_STATUS.COMPLETED
    ));
    return {
      communityId,
      visitWindowId,
      ...(sample.visitWindowName ? { visitWindowName: sample.visitWindowName } : {}),
      ...(interval.startTime ? { windowStart: interval.startTime } : {}),
      ...(interval.endTime ? { windowEnd: interval.endTime } : {}),
      allDay: interval.allDay,
      windowTimesKnown: interval.known,
      ...(interval.known && interval.startMinute !== undefined && interval.endMinute !== undefined
        ? { availableMinutes: interval.endMinute - interval.startMinute }
        : {}),
      scheduledCount: group.length,
      assignedCount: group.filter((visit) => Boolean(visit.crewAssignment)).length,
      unassignedCount: unassigned.length,
      unassignedVisits: unassigned.map(toView),
      crews: [...crewBuckets.entries()].map(([crewId, items]) => {
        const crew = crews.get(crewId);
        const active = crew ? activeStaff(crew) : [];
        return {
          crewId,
          ...(crew?.name ? { crewName: crew.name } : {}),
          ...(crew?.vanLabel ? { vanLabel: crew.vanLabel } : {}),
          staff: crew?.staff ?? [],
          staffIds: active.map((member) => member.staffId),
          activeStaffCount: active.length,
          visitCount: items.length,
          visits: items.map(toView),
          workload: workloadFor(workloadVisits(items).map((visit) => visit.durationMinutes), interval),
        };
      }),
    };
  }).sort((left, right) => (
    left.communityId.localeCompare(right.communityId)
    || left.visitWindowId.localeCompare(right.visitWindowId)
  ));
}

function occupiedSlots(
  visits: PackageVisitRecord[],
  intervals: Map<string, WindowInterval>,
  crews: Map<string, SchedulingCrew>,
): OccupiedSlot[] {
  const buckets = new Map<string, PackageVisitRecord[]>();
  for (const visit of visits) {
    if (!OCCUPYING_STATUSES.includes(visit.status) || !visit.crewAssignment || !visit.schedule || !visit.communityId || !visit.visitWindowId) {
      continue;
    }
    const key = `${visit.schedule.date}\u0000${visit.communityId}\u0000${visit.visitWindowId}\u0000${visit.crewAssignment.crewId}`;
    const list = buckets.get(key) ?? [];
    list.push(visit);
    buckets.set(key, list);
  }
  return [...buckets.values()].map((group) => {
    const sample = group[0];
    const crewId = sample.crewAssignment!.crewId;
    const crew = crews.get(crewId);
    return {
      date: sample.schedule!.date,
      communityId: sample.communityId!,
      visitWindowId: sample.visitWindowId!,
      crewId,
      staffIds: crew ? activeStaff(crew).map((member) => member.staffId) : [],
      interval: consensusInterval(group.map((visit) => intervals.get(visit.visitId) ?? { known: false, allDay: false })),
      ...(crew ? {} : { crewRecordMissing: true }),
    };
  });
}

function conflictsAmong(slots: OccupiedSlot[]): AssignmentConflict[] {
  const found: AssignmentConflict[] = [];
  for (let index = 0; index < slots.length; index += 1) {
    found.push(...assignmentConflicts({ target: slots[index], others: slots.slice(index + 1) }));
  }
  return dedupeConflicts(found);
}

function toView(visit: PackageVisitRecord): AssignmentVisitView {
  const known = durationKnown(visit.durationMinutes);
  return {
    visitId: visit.visitId,
    planId: visit.planId,
    status: visit.status,
    ...(visit.registrationNumber ? { registrationNumber: visit.registrationNumber } : {}),
    ...(visit.vehicleDisplayName ? { vehicleDisplayName: visit.vehicleDisplayName } : {}),
    serviceName: visit.serviceName,
    ...(known ? { durationMinutes: visit.durationMinutes } : {}),
    durationKnown: known,
    ...(visit.crewAssignment?.crewId ? { crewId: visit.crewAssignment.crewId } : {}),
  };
}

function intervalsConflict(left: WindowInterval, right: WindowInterval): 'overlap' | 'clear' | 'unknown' {
  if (!left.known || !right.known || left.startMinute === undefined || left.endMinute === undefined
    || right.startMinute === undefined || right.endMinute === undefined) {
    return 'unknown';
  }
  return left.startMinute < right.endMinute && right.startMinute < left.endMinute ? 'overlap' : 'clear';
}

function sameSlot(left: OccupiedSlot, right: OccupiedSlot): boolean {
  return left.date === right.date
    && left.communityId === right.communityId
    && left.visitWindowId === right.visitWindowId;
}

function compareSlots(left: OccupiedSlot, right: OccupiedSlot): number {
  if (left.date !== right.date) return left.date < right.date ? -1 : 1;
  const leftStart = left.interval.known ? left.interval.startMinute ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
  const rightStart = right.interval.known ? right.interval.startMinute ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
  return leftStart - rightStart;
}

function absoluteMinute(date: string, minute: number, origin: string): number {
  return (inclusiveDayCount(origin, date) - 1) * 24 * 60 + minute;
}

function dedupeConflicts(conflicts: AssignmentConflict[]): AssignmentConflict[] {
  const seen = new Set<string>();
  return conflicts.filter((item) => {
    const key = `${item.code}:${item.crewId ?? ''}:${item.staffId ?? ''}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function minutesOf(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = TIME_PATTERN.exec(value);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

function conflict(code: string, message: string, field?: string): BookingError {
  return new BookingError(code, message, code === 'CROSS_VENDOR_VISIT' ? 403 : 409, field, false);
}

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body is required');
  }
  return body as Record<string, unknown>;
}

function requireDate(value: unknown, field: string): string {
  const date = typeof value === 'string' ? value.trim() : '';
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new ValidationError(`${field} must be YYYY-MM-DD`);
  }
  return date;
}

function requireId(value: unknown, field: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 80) throw new ValidationError(`${field} is invalid`);
  return id;
}

function requireVisitIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ASSIGNMENT_VISITS) {
    throw new ValidationError(`visitIds must contain 1 to ${MAX_ASSIGNMENT_VISITS} ids`);
  }
  const ids = value.map((entry, index) => {
    const id = typeof entry === 'string' ? entry.trim() : '';
    if (!id || id.length > 80) throw new ValidationError(`visitIds[${index}] is invalid`);
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new ValidationError('visitIds must be unique');
  return ids;
}
