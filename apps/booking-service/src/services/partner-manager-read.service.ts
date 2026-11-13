import { BaseError, ForbiddenError, LambdaRequest, ValidationError } from '@api-hub/utils';

import { assertVendorOperationsAccess } from '../auth/vendor-operations';
import { enrichVisitFromPlan } from '../domain/package-visit';
import { isActiveVisitBlocker } from '../domain/vendor-issue';
import {
  PACKAGE_VISIT_STATUS,
  PackageVisitRecord,
  PackageVisitSchedule,
  PackageVisitStatus,
  VISIT_VALIDATION_STATUS,
  VisitValidationStatus,
} from '../types/package-visit.types';
import { CustomerPlanRecord } from '../types/customer-plan.types';
import { VendorIssueRecord } from '../types/vendor-issue.types';
import { CustomerPlansRepository, getCustomerPlansRepository } from '../repositories/customer-plans.repository';
import { VendorIssuesRepository, getVendorIssuesRepository } from '../repositories/vendor-issues.repository';
import { OperationalAccessGateway, getOperationalAccessGateway } from '../integrations/vendor.client';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 4;
const MAX_VISITS = 1_500;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
/** Tolerated clock skew between Lambdas when validating a cursor snapshot instant. */
const MAX_CURSOR_CLOCK_SKEW_MS = 5 * 60_000;
const REVIEW_STATUSES: ReadonlySet<string> = new Set(Object.values(VISIT_VALIDATION_STATUS));
const MANAGER_ROLES = new Set(['vendor', 'vendor_manager', 'vendor_owner', 'manager', 'owner']);
const MANAGER_PERMISSIONS = new Set(['vendor:read', 'operations:view', 'visits:view']);

export interface DelegatedPartnerActor {
  userId: string;
  vendorId: string;
  roles: string[];
  permissions: string[];
  correlationId: string;
}

export interface PartnerManagerReadEvent {
  actor?: unknown;
  action?: unknown;
  query?: unknown;
}

type ReadAction = 'overview' | 'work' | 'planning';
type WorkView = 'all' | 'active' | 'completed';
type PlanningTab = 'unassigned' | 'assigned' | 'availability';

interface Query {
  date?: string;
  dates?: string;
  communityId?: string;
  visitWindowId?: string;
  view?: WorkView;
  tab?: PlanningTab;
  pageSize?: number;
  cursor?: string;
}

interface ProjectedVisit {
  visitId: string;
  planId: string;
  communityId?: string;
  visitWindowId?: string;
  visitWindowName?: string;
  window?: { startTime?: string; endTime?: string; allDay?: boolean };
  date: string;
  startTime?: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'MISSED';
  /** When the visit entered its current status. Omitted when no authoritative timestamp is stored. */
  statusAt?: string;
  /** Completion evidence review state, copied from `validationStatus`. */
  reviewStatus?: VisitValidationStatus;
  parkingBay?: string;
  crewId?: string;
  vehicle?: { vehicleId?: string; registrationNumber?: string; displayName?: string; vehicleType?: string };
  service: { serviceId: string; name: string; estimatedMinutes: number };
}

interface CrewSummary {
  crewId: string;
  /** Whole filtered day for this crew, independent of the requested page and view. */
  progress: Progress;
}

interface Progress {
  expected: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  /** Null means the optional issue dependency was unavailable, never zero. */
  blocked: number | null;
  unassigned: number;
  missed: number;
  cancelled: number;
}

interface ProjectedIssue {
  issueId: string;
  visitId?: string;
  communityId?: string;
  type: string;
  status: 'OPEN' | 'TRIAGED' | 'ACTION_REQUIRED' | 'RESOLVED';
  createdAt: string;
  updatedAt: string;
  blocksVisit?: boolean;
  blockingStartedAt?: string;
}

interface PageScope {
  vendorId: string;
  date: string;
  communityId?: string;
  visitWindowId?: string;
  mode: WorkView | PlanningTab;
}

interface SortKey {
  startTime: string;
  visitId: string;
}

/** Issued before keyset pagination. Still accepted so in-flight walks survive a deploy. */
interface LegacyCursorPayload extends PageScope {
  version: 1;
  offset: number;
}

/**
 * A walk is pinned to `asOf`: membership and order are evaluated against each
 * visit's state at that instant, so later status changes or reschedules cannot
 * shift a visit across the `after` boundary.
 */
interface CursorPayload extends PageScope {
  version: 2;
  asOf: string;
  after: SortKey;
}

type ParsedCursor =
  | { kind: 'offset'; offset: number }
  | { kind: 'keyset'; asOf: number; after: SortKey };

type Membership = (visit: PackageVisitRecord, asOf: number) => boolean;

/**
 * Domain-owned, direct-Lambda read adapter for Partner BFF. Its only transport
 * is Lambda Invoke: Lambda IAM authenticates the calling workload and this
 * service re-checks the delegated user against the canonical vendor membership.
 */
export class PartnerManagerReadService {
  constructor(
    private readonly plans: CustomerPlansRepository = getCustomerPlansRepository(),
    private readonly issues: VendorIssuesRepository = getVendorIssuesRepository(),
    private readonly vendors: OperationalAccessGateway = getOperationalAccessGateway(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(event: PartnerManagerReadEvent | null): Promise<unknown> {
    const actor = parseActor(event?.actor);
    const action = parseAction(event?.action);
    const query = parseQuery(event?.query);
    await this.authorize(actor);
    if (action === 'overview') return this.overview(actor, query);
    if (action === 'work') return this.work(actor, query);
    return this.planning(actor, query);
  }

  private async overview(actor: DelegatedPartnerActor, query: Query) {
    const dates = parseDates(query.dates);
    const [days, issueResult] = await Promise.all([
      Promise.all(dates.map(async (date) => ({ date, visits: await this.loadDate(actor.vendorId, date) }))),
      this.loadIssues(actor.vendorId)
        .then((issues) => ({ available: true as const, issues }))
        .catch(() => ({ available: false as const, issues: [] as VendorIssueRecord[] })),
    ]);
    return {
      timezone: 'Asia/Kolkata',
      days: days.map((day) => ({
        date: day.date,
        visits: day.visits.map(project),
        progress: progress(day.visits, issueResult.issues, issueResult.available),
      })),
      issues: issueResult.issues.map(projectIssue),
      issuesAvailable: issueResult.available,
      sourceAsOf: this.now().toISOString(),
    };
  }

  private async work(actor: DelegatedPartnerActor, query: Query) {
    const date = requireDate(query.date, 'date');
    const visits = filter(await this.loadDate(actor.vendorId, date), query);
    const issueResult = await this.loadIssues(actor.vendorId)
      .then((issues) => ({ available: true as const, issues }))
      .catch(() => ({ available: false as const, issues: [] as VendorIssueRecord[] }));
    const view = query.view ?? 'all';
    const page = paginate(
      visits,
      pageScope(actor.vendorId, date, query, view),
      query,
      (visit, asOf) => matchesWorkView(statusAsOf(visit, asOf), view),
      this.now(),
    );
    const visitIds = new Set(visits.map((visit) => visit.visitId));
    return {
      timezone: 'Asia/Kolkata',
      date,
      summary: progress(visits, issueResult.issues, issueResult.available),
      crewSummaries: crewSummaries(visits, issueResult.issues, issueResult.available),
      items: page.items.map(project),
      issues: issueResult.issues
        .filter((issue) => issue.visitId && visitIds.has(issue.visitId))
        .map(projectIssue),
      issuesAvailable: issueResult.available,
      total: page.total,
      nextCursor: page.nextCursor,
      hasMore: Boolean(page.nextCursor),
      sourceAsOf: this.now().toISOString(),
    };
  }

  private async planning(actor: DelegatedPartnerActor, query: Query) {
    const date = requireDate(query.date, 'date');
    const visits = filter(await this.loadDate(actor.vendorId, date), query);
    const tab = query.tab ?? 'unassigned';
    const scheduled = visits.filter(isScheduledWork);
    const page = paginate(
      visits,
      pageScope(actor.vendorId, date, query, tab),
      query,
      (visit, asOf) => tab !== 'availability'
        && isScheduledStatus(statusAsOf(visit, asOf))
        && assignedAsOf(visit, asOf) === (tab === 'assigned'),
      this.now(),
    );
    return {
      timezone: 'Asia/Kolkata',
      date,
      tab,
      counts: {
        scheduled: scheduled.length,
        assigned: scheduled.filter((visit) => Boolean(visit.crewAssignment?.crewId)).length,
        unassigned: scheduled.filter((visit) => !visit.crewAssignment?.crewId).length,
      },
      summary: progress(visits, [], true),
      items: page.items.map(project),
      nextCursor: page.nextCursor,
      hasMore: Boolean(page.nextCursor),
      sourceAsOf: this.now().toISOString(),
    };
  }

  private async authorize(actor: DelegatedPartnerActor): Promise<void> {
    // The request is accepted only after the IAM-authenticated direct invocation
    // reaches this function. Delegation is still constrained to the user's live,
    // canonical vendor membership rather than trusting a caller-selected vendor.
    const request = delegatedRequest(actor);
    await assertVendorOperationsAccess(request, actor.vendorId, this.vendors);
  }

  private async loadDate(vendorId: string, date: string): Promise<PackageVisitRecord[]> {
    const visits = await this.plans.listVendorVisitsForDate(vendorId, date);
    if (visits.length > MAX_VISITS) {
      throw new BaseError('The selected date contains too much work to summarize safely', 409, 'SUMMARY_TOO_LARGE');
    }
    const plans = new Map<string, CustomerPlanRecord | null>();
    const missing = [...new Set(visits.filter((visit) => !visit.communityId || !visit.visitWindowId).map((visit) => visit.planId))];
    await Promise.all(missing.map(async (planId) => plans.set(planId, await this.plans.getPlan(planId))));
    return visits.map((visit) => enrichVisitFromPlan(visit, plans.get(visit.planId)));
  }

  private async loadIssues(vendorId: string): Promise<VendorIssueRecord[]> {
    const issues = await this.issues.listVendorIssues(vendorId);
    if (issues.length > MAX_VISITS) {
      throw new BaseError('The selected vendor has too many issues to summarize safely', 409, 'SUMMARY_TOO_LARGE');
    }
    return issues;
  }
}

function parseActor(value: unknown): DelegatedPartnerActor {
  const actor = record(value);
  const userId = text(actor.userId);
  const vendorId = text(actor.vendorId);
  const correlationId = text(actor.correlationId);
  const roles = strings(actor.roles);
  const permissions = strings(actor.permissions);
  if (!userId || !vendorId || !correlationId) throw new BaseError('Delegated actor is required', 401, 'UNAUTHORIZED');
  const managerRole = roles.some((role) => MANAGER_ROLES.has(normalize(role)));
  const managerPermission = permissions.some((permission) => MANAGER_PERMISSIONS.has(permission.trim().toLowerCase()));
  if (!managerRole && !managerPermission) throw new ForbiddenError('Partner manager access is required');
  return { userId, vendorId, correlationId, roles, permissions };
}

function parseAction(value: unknown): ReadAction {
  if (value === 'overview' || value === 'work' || value === 'planning') return value;
  throw new ValidationError('action must be overview, work, or planning');
}

function parseQuery(value: unknown): Query {
  const input = record(value);
  const view = text(input.view);
  const tab = text(input.tab);
  if (view && view !== 'all' && view !== 'active' && view !== 'completed') throw new ValidationError('view is invalid');
  if (tab && tab !== 'unassigned' && tab !== 'assigned' && tab !== 'availability') throw new ValidationError('tab is invalid');
  const pageSize = input.pageSize === undefined ? undefined : Number(input.pageSize);
  if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE)) {
    throw new ValidationError(`pageSize must be an integer from 1 to ${MAX_PAGE_SIZE}`);
  }
  return {
    ...(text(input.date) ? { date: text(input.date) } : {}),
    ...(text(input.dates) ? { dates: text(input.dates) } : {}),
    ...(text(input.communityId) ? { communityId: requireId(text(input.communityId)!, 'communityId') } : {}),
    ...(text(input.visitWindowId) ? { visitWindowId: requireId(text(input.visitWindowId)!, 'visitWindowId') } : {}),
    ...(view ? { view: view as WorkView } : {}),
    ...(tab ? { tab: tab as PlanningTab } : {}),
    ...(pageSize ? { pageSize } : {}),
    ...(text(input.cursor) ? { cursor: text(input.cursor) } : {}),
  };
}

function parseDates(value: string | undefined): string[] {
  const dates = (value ?? '').split(',').map((date) => date.trim()).filter(Boolean);
  if (dates.length < 1 || dates.length > MAX_DAYS) throw new ValidationError(`dates must contain 1 to ${MAX_DAYS} dates`);
  const unique = [...new Set(dates.map((date) => requireDate(date, 'dates')))];
  if (unique.length !== dates.length) throw new ValidationError('dates must not contain duplicates');
  return unique;
}

function filter(visits: readonly PackageVisitRecord[], query: Query): PackageVisitRecord[] {
  return visits.filter((visit) =>
    Boolean(visit.schedule?.date)
    && (!query.communityId || visit.communityId === query.communityId)
    && (!query.visitWindowId || visit.visitWindowId === query.visitWindowId));
}

function matchesWorkView(status: PackageVisitStatus, view: WorkView): boolean {
  if (view === 'all') return true;
  if (view === 'completed') return status === PACKAGE_VISIT_STATUS.COMPLETED;
  return isScheduledStatus(status);
}

function isScheduledWork(visit: PackageVisitRecord): boolean {
  return isScheduledStatus(visit.status);
}

function isScheduledStatus(status: PackageVisitStatus): boolean {
  return status === PACKAGE_VISIT_STATUS.SCHEDULED || status === PACKAGE_VISIT_STATUS.IN_PROGRESS;
}

/**
 * Status at `asOf`, reconstructed from transition timestamps. A missing
 * timestamp on a legacy row keeps the current status rather than guessing.
 */
function statusAsOf(visit: PackageVisitRecord, asOf: number): PackageVisitStatus {
  const after = (value: string | undefined) => instant(value) > asOf;
  switch (visit.status) {
    case PACKAGE_VISIT_STATUS.COMPLETED:
      if (!after(visit.completedAt)) return visit.status;
      return after(visit.startedAt) ? PACKAGE_VISIT_STATUS.SCHEDULED : PACKAGE_VISIT_STATUS.IN_PROGRESS;
    case PACKAGE_VISIT_STATUS.IN_PROGRESS:
      return after(visit.startedAt) ? PACKAGE_VISIT_STATUS.SCHEDULED : visit.status;
    case PACKAGE_VISIT_STATUS.CANCELLED:
      if (!after(visit.cancelledAt)) return visit.status;
      return visit.startedAt && !after(visit.startedAt) ? PACKAGE_VISIT_STATUS.IN_PROGRESS : PACKAGE_VISIT_STATUS.SCHEDULED;
    case PACKAGE_VISIT_STATUS.MISSED:
      return after(visit.missedAt) ? PACKAGE_VISIT_STATUS.SCHEDULED : visit.status;
    default:
      return visit.status;
  }
}

/** An unassignment after `asOf` clears the record, so only later assignments can be undone here. */
function assignedAsOf(visit: PackageVisitRecord, asOf: number): boolean {
  return Boolean(visit.crewAssignment?.crewId) && !(instant(visit.crewAssignment?.assignedAt) > asOf);
}

/**
 * Sort key on `date` at `asOf`. The earliest schedule change after `asOf`
 * carries the prior schedule in `from`; a visit first scheduled after `asOf`
 * was not part of the snapshot.
 */
function sortKeyAsOf(visit: PackageVisitRecord, date: string, asOf: number): SortKey | undefined {
  const keyOf = (schedule: Partial<PackageVisitSchedule> | undefined) => schedule?.date === date
    ? { startTime: schedule.startTime ?? '', visitId: visit.visitId }
    : undefined;
  const earliestLater = (visit.scheduleHistory ?? [])
    .filter((entry) => instant(entry.at) > asOf)
    .sort((left, right) => instant(left.at) - instant(right.at))[0];
  if (!earliestLater) return keyOf(visit.schedule);
  if (earliestLater.action === 'scheduled' && !earliestLater.from) return undefined;
  return keyOf(earliestLater.from?.date ? earliestLater.from : visit.schedule);
}

function compareKeys(left: SortKey, right: SortKey): number {
  return left.startTime.localeCompare(right.startTime) || left.visitId.localeCompare(right.visitId);
}

function instant(value: string | undefined): number {
  return value ? Date.parse(value) : Number.NaN;
}

function progress(
  visits: readonly PackageVisitRecord[],
  issues: readonly VendorIssueRecord[],
  issuesAvailable: boolean,
): Progress {
  const blockingVisitIds = new Set(issues.filter((issue) => isActiveVisitBlocker(issue) && issue.visitId).map((issue) => issue.visitId!));
  const result: Progress = {
    expected: 0,
    completed: 0,
    inProgress: 0,
    notStarted: 0,
    blocked: issuesAvailable ? 0 : null,
    unassigned: 0,
    missed: 0,
    cancelled: 0,
  };
  for (const visit of visits) {
    if (visit.status === PACKAGE_VISIT_STATUS.CANCELLED) {
      result.cancelled += 1;
    } else if (visit.status === PACKAGE_VISIT_STATUS.MISSED) {
      result.missed += 1;
    } else if (visit.status === PACKAGE_VISIT_STATUS.COMPLETED) {
      result.expected += 1;
      result.completed += 1;
    } else if (visit.status === PACKAGE_VISIT_STATUS.IN_PROGRESS) {
      result.expected += 1;
      result.inProgress += 1;
    } else if (visit.status === PACKAGE_VISIT_STATUS.SCHEDULED) {
      result.expected += 1;
      if (blockingVisitIds.has(visit.visitId)) result.blocked = (result.blocked ?? 0) + 1;
      else if (!visit.crewAssignment?.crewId) result.unassigned += 1;
      else result.notStarted += 1;
    }
  }
  return result;
}

function crewSummaries(
  visits: readonly PackageVisitRecord[],
  issues: readonly VendorIssueRecord[],
  issuesAvailable: boolean,
): CrewSummary[] {
  const byCrew = new Map<string, PackageVisitRecord[]>();
  for (const visit of visits) {
    const crewId = visit.crewAssignment?.crewId;
    if (crewId) byCrew.set(crewId, [...(byCrew.get(crewId) ?? []), visit]);
  }
  return [...byCrew.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([crewId, crewVisits]) => ({ crewId, progress: progress(crewVisits, issues, issuesAvailable) }));
}

function pageScope(vendorId: string, date: string, query: Query, mode: WorkView | PlanningTab): PageScope {
  return {
    vendorId,
    date,
    ...(query.communityId ? { communityId: query.communityId } : {}),
    ...(query.visitWindowId ? { visitWindowId: query.visitWindowId } : {}),
    mode,
  };
}

/**
 * Keyset pagination over (startTime, visitId) evaluated at the walk's snapshot
 * instant. A visit returned on an earlier page always sorts at or before the
 * cursor, and an unreturned snapshot member always sorts after it, so a walk
 * cannot duplicate or skip a visit that stays on the date. Visits scheduled
 * onto the date after the snapshot appear on the next fresh walk.
 */
function paginate(
  candidates: readonly PackageVisitRecord[],
  scope: PageScope,
  query: Query,
  matches: Membership,
  now: Date,
) {
  const cursor = parseCursor(query.cursor, scope, now);
  const asOf = cursor?.kind === 'keyset' ? cursor.asOf : snapshotInstant(candidates, now);
  const entries = candidates
    .flatMap((visit) => {
      const key = sortKeyAsOf(visit, scope.date, asOf);
      return key && matches(visit, asOf) ? [{ visit, key }] : [];
    })
    .sort((left, right) => compareKeys(left.key, right.key));
  let start = 0;
  if (cursor?.kind === 'offset') start = Math.min(cursor.offset, entries.length);
  if (cursor?.kind === 'keyset') {
    const index = entries.findIndex((entry) => compareKeys(entry.key, cursor.after) > 0);
    start = index < 0 ? entries.length : index;
  }
  const pageEntries = entries.slice(start, start + (query.pageSize ?? DEFAULT_PAGE_SIZE));
  const last = pageEntries[pageEntries.length - 1];
  const nextCursor = last && start + pageEntries.length < entries.length
    ? encodeCursor({ version: 2, ...scope, asOf: new Date(asOf).toISOString(), after: last.key })
    : null;
  return { items: pageEntries.map((entry) => entry.visit), nextCursor, total: entries.length };
}

/**
 * Every visit mutation writes `updatedAt` with the same instant as its
 * transition timestamp, so pinning the snapshot at or after the newest
 * `updatedAt` makes reconstruction at `asOf` equal the state this page saw.
 */
function snapshotInstant(visits: readonly PackageVisitRecord[], now: Date): number {
  return visits.reduce((latest, visit) => {
    const updatedAt = instant(visit.updatedAt);
    return Number.isFinite(updatedAt) && updatedAt > latest ? updatedAt : latest;
  }, now.getTime());
}

function parseCursor(cursor: string | undefined, scope: PageScope, now: Date): ParsedCursor | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = record(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (parsed.vendorId !== scope.vendorId || parsed.date !== scope.date
      || parsed.communityId !== scope.communityId || parsed.visitWindowId !== scope.visitWindowId
      || parsed.mode !== scope.mode) {
      throw new Error('incompatible');
    }
    if (parsed.version === 1) {
      const { offset } = parsed as unknown as LegacyCursorPayload;
      if (!Number.isInteger(offset) || offset < 0) throw new Error('incompatible');
      return { kind: 'offset', offset };
    }
    if (parsed.version !== 2) throw new Error('incompatible');
    const asOf = typeof parsed.asOf === 'string' ? Date.parse(parsed.asOf) : Number.NaN;
    const after = record(parsed.after);
    if (!Number.isFinite(asOf) || asOf > now.getTime() + MAX_CURSOR_CLOCK_SKEW_MS
      || typeof after.startTime !== 'string' || after.startTime.length > 16
      || typeof after.visitId !== 'string' || !after.visitId || after.visitId.length > 128) {
      throw new Error('incompatible');
    }
    return { kind: 'keyset', asOf, after: { startTime: after.startTime, visitId: after.visitId } };
  } catch {
    throw new ValidationError('cursor is invalid for the current vendor and filters');
  }
}

function encodeCursor(value: CursorPayload): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function project(visit: PackageVisitRecord): ProjectedVisit {
  if (!visit.schedule?.date) throw new ValidationError('Scheduled visit is missing a date');
  if (visit.status === PACKAGE_VISIT_STATUS.UNSCHEDULED) throw new ValidationError('Unscheduled visit cannot be projected');
  const statusAt = currentStatusAt(visit);
  const parkingBay = visit.parkingBay?.trim();
  return {
    visitId: visit.visitId,
    planId: visit.planId,
    ...(visit.communityId ? { communityId: visit.communityId } : {}),
    ...(visit.visitWindowId ? { visitWindowId: visit.visitWindowId } : {}),
    ...(visit.visitWindowName ? { visitWindowName: visit.visitWindowName } : {}),
    ...(visit.visitWindowSnapshot ? { window: {
      ...(visit.visitWindowSnapshot.startTime ? { startTime: visit.visitWindowSnapshot.startTime } : {}),
      ...(visit.visitWindowSnapshot.endTime ? { endTime: visit.visitWindowSnapshot.endTime } : {}),
      ...(visit.visitWindowSnapshot.allDay !== undefined ? { allDay: visit.visitWindowSnapshot.allDay } : {}),
    } } : {}),
    date: visit.schedule.date,
    ...(visit.schedule.startTime ? { startTime: visit.schedule.startTime } : {}),
    status: visit.status,
    ...(statusAt ? { statusAt } : {}),
    ...(visit.validationStatus && REVIEW_STATUSES.has(visit.validationStatus) ? { reviewStatus: visit.validationStatus } : {}),
    ...(parkingBay ? { parkingBay } : {}),
    ...(visit.crewAssignment?.crewId ? { crewId: visit.crewAssignment.crewId } : {}),
    vehicle: {
      ...(visit.vehicleId ? { vehicleId: visit.vehicleId } : {}),
      ...(visit.registrationNumber ? { registrationNumber: visit.registrationNumber } : {}),
      ...(visit.vehicleDisplayName ? { displayName: visit.vehicleDisplayName } : {}),
      ...(visit.vehicleType ? { vehicleType: visit.vehicleType } : {}),
    },
    service: { serviceId: visit.serviceId, name: visit.serviceName, estimatedMinutes: visit.durationMinutes },
  };
}

/**
 * SCHEDULED uses the latest schedule/reschedule transition. Rows without that
 * history (or without the terminal timestamp) omit the field.
 */
function currentStatusAt(visit: PackageVisitRecord): string | undefined {
  switch (visit.status) {
    case PACKAGE_VISIT_STATUS.IN_PROGRESS: return timestamp(visit.startedAt);
    case PACKAGE_VISIT_STATUS.COMPLETED: return timestamp(visit.completedAt);
    case PACKAGE_VISIT_STATUS.MISSED: return timestamp(visit.missedAt);
    case PACKAGE_VISIT_STATUS.CANCELLED: return timestamp(visit.cancelledAt);
    case PACKAGE_VISIT_STATUS.SCHEDULED:
      return (visit.scheduleHistory ?? [])
        .filter((entry) => (entry.action === 'scheduled' || entry.action === 'rescheduled') && timestamp(entry.at))
        .sort((left, right) => instant(right.at) - instant(left.at))[0]?.at;
    default:
      return undefined;
  }
}

function timestamp(value: string | undefined): string | undefined {
  return value && Number.isFinite(Date.parse(value)) ? value : undefined;
}

/**
 * Resolved issues stay in the list as history, but `blocksVisit` and
 * `blockingStartedAt` are projected only while the issue still blocks.
 */
function projectIssue(issue: VendorIssueRecord): ProjectedIssue {
  const blocking = isActiveVisitBlocker(issue);
  return {
    issueId: issue.issueId,
    ...(issue.visitId ? { visitId: issue.visitId } : {}),
    ...(issue.communityId ? { communityId: issue.communityId } : {}),
    type: issue.type,
    status: issue.status,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    ...(blocking ? { blocksVisit: true } : {}),
    ...(blocking && issue.blockingStartedAt ? { blockingStartedAt: issue.blockingStartedAt } : {}),
  };
}

function delegatedRequest(actor: DelegatedPartnerActor): LambdaRequest {
  return {
    pathParameters: { vendorId: actor.vendorId },
    params: {},
    event: {} as LambdaRequest['event'],
    context: {
      correlationId: actor.correlationId,
      awsRequestId: actor.correlationId,
      logger: undefined,
      authContext: {
        identityId: 'partner-bff-delegated',
        userId: actor.userId,
        roles: actor.roles,
        permissions: actor.permissions,
        claims: {},
      },
    },
  };
}

function requireDate(value: string | undefined, field: string): string {
  const date = value?.trim() ?? '';
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!DATE.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new ValidationError(`${field} must be YYYY-MM-DD`);
  }
  return date;
}

function requireId(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) throw new ValidationError(`${field} is invalid`);
  return value;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

let service: PartnerManagerReadService | undefined;

export function getPartnerManagerReadService(): PartnerManagerReadService {
  if (!service) service = new PartnerManagerReadService();
  return service;
}
