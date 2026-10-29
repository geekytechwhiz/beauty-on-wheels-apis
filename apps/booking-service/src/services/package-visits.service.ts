import {
  BusinessRuleError,
  ConditionalWriteConflictError,
  ConflictError,
  ForbiddenError,
  LambdaRequest,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { headerValue } from '../auth/access';
import {
  VisitActor,
  assertCustomerOrVendorForPlan,
  assertVendorStaffForPlan,
  resolveVisitActor,
} from '../auth/visit-access';
import {
  appendScheduleHistory,
  assertSchedulePayload,
  assertVisitTransition,
  computeVisitProgress,
  operationalSnapshot,
  toVisitResponse,
  validityEndsAt,
} from '../domain/package-visit';
import { BookingError } from '../errors';
import { AvailabilityGateway, getAvailabilityGateway } from '../integrations/availability.client';
import {
  CustomerPlansRepository,
  getCustomerPlansRepository,
} from '../repositories/customer-plans.repository';
import { CustomerPlanRecord } from '../types/customer-plan.types';
import {
  PACKAGE_SCHEDULE_STATE,
  PACKAGE_VISIT_STATUS,
  PackageVisitListPage,
  PackageVisitRecord,
  PackageVisitResponse,
  PackageVisitSchedule,
} from '../types/package-visit.types';

const baseLogger = createLogger({ service: 'package-visits-service', redactPII: true });

export class PackageVisitsService {
  private readonly logger = createChildLogger(baseLogger, { service: 'PackageVisitsService' });

  constructor(
    private readonly plans: CustomerPlansRepository = getCustomerPlansRepository(),
    private readonly availability: AvailabilityGateway = getAvailabilityGateway(),
  ) {}

  async list(request: LambdaRequest): Promise<PackageVisitListPage> {
    const actor = resolveVisitActor(request);
    const planId = pathParam(request, 'planId');
    const plan = await this.requirePlanAccess(planId, actor);
    const limit = Math.min(Math.max(Number(request.queryStringParameters?.limit ?? 50) || 50, 1), 100);
    const cursor = decodeCursor(request.queryStringParameters?.cursor);
    const page = await this.plans.listVisitsPage(plan.planId, {
      limit,
      ...(cursor ? { exclusiveStartKey: cursor } : {}),
    });
    return {
      items: page.items.map(toVisitResponse),
      hasMore: Boolean(page.lastEvaluatedKey),
      ...(page.lastEvaluatedKey
        ? { nextCursor: Buffer.from(JSON.stringify(page.lastEvaluatedKey)).toString('base64url') }
        : {}),
    };
  }

  async get(request: LambdaRequest): Promise<PackageVisitResponse> {
    const actor = resolveVisitActor(request);
    const planId = pathParam(request, 'planId');
    const visitId = pathParam(request, 'visitId');
    const plan = await this.requirePlanAccess(planId, actor);
    const visit = await this.requireVisit(plan.planId, visitId);
    return toVisitResponse(visit);
  }

  /**
   * Vendor schedules a single visit: reserve Availability capacity first, then
   * persist SCHEDULED. Uses visitId as the availability bookingId for correlation.
   */
  async schedule(request: LambdaRequest): Promise<PackageVisitResponse> {
    const actor = resolveVisitActor(request);
    const planId = pathParam(request, 'planId');
    const visitId = pathParam(request, 'visitId');
    const idempotencyKey = requireIdempotency(request);
    const plan = await this.requirePlanAccess(planId, actor);
    assertVendorStaffForPlan(actor, plan);
    this.assertPlanPaid(plan);

    const body = (request.body ?? {}) as Record<string, unknown>;
    const schedule = {
      date: String(body.date ?? ''),
      startTime: String(body.startTime ?? ''),
      timezone: String(body.timezone ?? ''),
      branchId: String(body.branchId ?? ''),
      durationMinutes: Number(body.durationMinutes ?? 0),
    };
    assertSchedulePayload(schedule);

    const visit = await this.requireVisit(plan.planId, visitId);
    if (visit.status === PACKAGE_VISIT_STATUS.SCHEDULED && visit.schedule) {
      if (sameSchedule(visit.schedule, schedule)) return toVisitResponse(visit);
      throw new BookingError('VISIT_ALREADY_SCHEDULED', 'Visit is already scheduled; use reschedule', 409, 'visitId', false);
    }
    assertVisitTransition(visit.status, PACKAGE_VISIT_STATUS.SCHEDULED);

    const durationMinutes = schedule.durationMinutes || visit.durationMinutes;
    const reserved = await this.availability.reserveBooking({
      bookingId: visit.visitId,
      customerId: plan.customerId,
      vendorId: plan.vendorId,
      branchId: schedule.branchId,
      offeringId: plan.offeringId || plan.packageId,
      vehicleType: plan.vehicleType,
      date: schedule.date,
      startTime: schedule.startTime,
      timezone: schedule.timezone,
      durationMinutes,
      packageVisitId: visit.visitId,
      planId: plan.planId,
      ...(plan.location.communityId ? { communityId: plan.location.communityId } : {}),
    });

    const now = new Date().toISOString();
    const nextSchedule: PackageVisitSchedule = {
      date: reserved.date,
      startTime: reserved.startTime,
      endTime: reserved.endTime,
      timezone: reserved.timezone,
      branchId: schedule.branchId,
      slotId: reserved.slotId,
      allocationId: visit.visitId,
      durationMinutes: reserved.durationMinutes ?? durationMinutes,
    };
    const next: PackageVisitRecord = {
      ...visit,
      ...operationalSnapshot(plan),
      status: PACKAGE_VISIT_STATUS.SCHEDULED,
      schedule: nextSchedule,
      scheduleHistory: appendScheduleHistory(visit, {
        at: now,
        action: 'scheduled',
        by: actor.staffId,
        to: nextSchedule,
        reason: `idempotency:${idempotencyKey}`,
      }),
      durationMinutes: nextSchedule.durationMinutes,
      updatedAt: now,
      version: visit.version + 1,
    };

    try {
      await this.plans.saveVisit(next, visit.version);
    } catch (error) {
      await this.releaseQuietly(visit.visitId);
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Visit was updated concurrently; retry with the same idempotency key');
      }
      throw error;
    }

    await this.refreshPlanProgress(plan.planId);
    this.logger.info({
      event: 'package_visit_scheduled',
      planId: plan.planId,
      visitId: visit.visitId,
      date: nextSchedule.date,
      idempotencyKey,
    });
    return toVisitResponse(next);
  }

  /**
   * Reschedule: reserve replacement slot first; only release the old reservation
   * after the new one succeeds. On reserve failure the original visit stays intact.
   */
  async reschedule(request: LambdaRequest): Promise<PackageVisitResponse> {
    const actor = resolveVisitActor(request);
    const planId = pathParam(request, 'planId');
    const visitId = pathParam(request, 'visitId');
    const idempotencyKey = requireIdempotency(request);
    const plan = await this.requirePlanAccess(planId, actor);
    if (actor.kind === 'customer' && actor.customerId !== plan.customerId) {
      throw new ForbiddenError('Not authorized to reschedule this visit');
    }
    if (actor.kind === 'vendor') assertVendorStaffForPlan(actor, plan);
    this.assertPlanPaid(plan);

    const body = (request.body ?? {}) as Record<string, unknown>;
    const schedule = {
      date: String(body.date ?? ''),
      startTime: String(body.startTime ?? ''),
      timezone: String(body.timezone ?? ''),
      branchId: String(body.branchId ?? ''),
      durationMinutes: Number(body.durationMinutes ?? 0),
    };
    assertSchedulePayload(schedule);

    const visit = await this.requireVisit(plan.planId, visitId);
    if (visit.status !== PACKAGE_VISIT_STATUS.SCHEDULED || !visit.schedule) {
      throw new BookingError('VISIT_NOT_SCHEDULED', 'Only scheduled visits can be rescheduled', 409, 'visitId', false);
    }
    if (sameSchedule(visit.schedule, schedule)) return toVisitResponse(visit);

    const newAllocationId = `${visit.visitId}-rs-${idempotencyKey.slice(0, 8)}`;
    const durationMinutes = schedule.durationMinutes || visit.durationMinutes;
    let reserved;
    try {
      reserved = await this.availability.reserveBooking({
        bookingId: newAllocationId,
        customerId: plan.customerId,
        vendorId: plan.vendorId,
        branchId: schedule.branchId,
        offeringId: plan.offeringId || plan.packageId,
        vehicleType: plan.vehicleType,
        date: schedule.date,
        startTime: schedule.startTime,
        timezone: schedule.timezone,
        durationMinutes,
        packageVisitId: visit.visitId,
        planId: plan.planId,
        ...(plan.location.communityId ? { communityId: plan.location.communityId } : {}),
      });
    } catch (error) {
      this.logger.warn({
        event: 'package_visit_reschedule_reserve_failed',
        planId: plan.planId,
        visitId: visit.visitId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const now = new Date().toISOString();
    const previous = visit.schedule;
    const nextSchedule: PackageVisitSchedule = {
      date: reserved.date,
      startTime: reserved.startTime,
      endTime: reserved.endTime,
      timezone: reserved.timezone,
      branchId: schedule.branchId,
      slotId: reserved.slotId,
      allocationId: newAllocationId,
      durationMinutes: reserved.durationMinutes ?? durationMinutes,
    };
    const next: PackageVisitRecord = {
      ...visit,
      ...operationalSnapshot(plan),
      status: PACKAGE_VISIT_STATUS.SCHEDULED,
      schedule: nextSchedule,
      scheduleHistory: appendScheduleHistory(visit, {
        at: now,
        action: 'rescheduled',
        by: actor.kind === 'vendor' ? actor.staffId : actor.customerId,
        from: previous,
        to: nextSchedule,
        reason: `idempotency:${idempotencyKey}`,
      }),
      durationMinutes: nextSchedule.durationMinutes,
      updatedAt: now,
      version: visit.version + 1,
    };

    try {
      await this.plans.saveVisit(next, visit.version);
    } catch (error) {
      await this.releaseQuietly(newAllocationId);
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Visit was updated concurrently; retry with the same idempotency key');
      }
      throw error;
    }

    await this.releaseQuietly(previous.allocationId ?? visit.visitId);
    await this.refreshPlanProgress(plan.planId);
    return toVisitResponse(next);
  }

  async cancel(request: LambdaRequest): Promise<PackageVisitResponse> {
    const actor = resolveVisitActor(request);
    const planId = pathParam(request, 'planId');
    const visitId = pathParam(request, 'visitId');
    const plan = await this.requirePlanAccess(planId, actor);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : undefined;

    const visit = await this.requireVisit(plan.planId, visitId);
    if (visit.status === PACKAGE_VISIT_STATUS.CANCELLED) return toVisitResponse(visit);
    assertVisitTransition(visit.status, PACKAGE_VISIT_STATUS.CANCELLED);

    const allocationId = visit.schedule?.allocationId ?? (visit.schedule ? visit.visitId : undefined);
    if (allocationId) await this.releaseQuietly(allocationId);

    const now = new Date().toISOString();
    const actorId = actor.kind === 'vendor' ? actor.staffId : actor.customerId;
    const next: PackageVisitRecord = {
      ...visit,
      status: PACKAGE_VISIT_STATUS.CANCELLED,
      schedule: undefined,
      scheduleHistory: appendScheduleHistory(visit, {
        at: now,
        action: 'cancelled',
        by: actorId,
        from: visit.schedule,
        reason,
      }),
      cancelledAt: now,
      cancelledBy: actorId,
      ...(reason ? { cancelReason: reason } : {}),
      updatedAt: now,
      version: visit.version + 1,
    };
    await this.plans.saveVisit(next, visit.version);
    await this.refreshPlanProgress(plan.planId);
    return toVisitResponse(next);
  }

  async start(request: LambdaRequest): Promise<PackageVisitResponse> {
    const actor = resolveVisitActor(request);
    const planId = pathParam(request, 'planId');
    const visitId = pathParam(request, 'visitId');
    const plan = await this.requirePlanAccess(planId, actor);
    assertVendorStaffForPlan(actor, plan);

    const visit = await this.requireVisit(plan.planId, visitId);
    if (visit.status === PACKAGE_VISIT_STATUS.IN_PROGRESS) return toVisitResponse(visit);
    assertVisitTransition(visit.status, PACKAGE_VISIT_STATUS.IN_PROGRESS);

    const now = new Date().toISOString();
    const next: PackageVisitRecord = {
      ...visit,
      status: PACKAGE_VISIT_STATUS.IN_PROGRESS,
      startedAt: now,
      startedBy: actor.staffId,
      updatedAt: now,
      version: visit.version + 1,
    };
    await this.plans.saveVisit(next, visit.version);

    if (plan.status !== 'ACTIVE') {
      await this.plans.savePlan(
        {
          ...plan,
          status: 'ACTIVE',
          firstJobId: plan.firstJobId ?? visit.visitId,
          billingPeriodStart: plan.billingPeriodStart ?? now,
          updatedAt: now,
          version: plan.version + 1,
        },
        plan.version,
      ).catch(() => undefined);
    }
    await this.refreshPlanProgress(plan.planId);
    return toVisitResponse(next);
  }

  /**
   * Completes a visit and consumes one entitlement unit idempotently.
   * Retry-safe: if already COMPLETED with entitlementConsumed, returns the visit.
   */
  async complete(request: LambdaRequest): Promise<PackageVisitResponse> {
    const actor = resolveVisitActor(request);
    const planId = pathParam(request, 'planId');
    const visitId = pathParam(request, 'visitId');
    requireIdempotency(request);
    const plan = await this.requirePlanAccess(planId, actor);
    assertVendorStaffForPlan(actor, plan);

    const visit = await this.requireVisit(plan.planId, visitId);
    if (visit.status === PACKAGE_VISIT_STATUS.COMPLETED && visit.entitlementConsumed) {
      return toVisitResponse(visit);
    }
    assertVisitTransition(visit.status, PACKAGE_VISIT_STATUS.COMPLETED);

    const now = new Date().toISOString();
    const completed: PackageVisitRecord = {
      ...visit,
      status: PACKAGE_VISIT_STATUS.COMPLETED,
      entitlementConsumed: true,
      completedAt: now,
      completedBy: actor.staffId,
      updatedAt: now,
      version: visit.version + 1,
    };

    const allVisits = await this.plans.listVisits(plan.planId);
    const merged = allVisits.map((row) => (row.visitId === visit.visitId ? completed : row));
    const progress = computeVisitProgress(merged);
    const nextPlan: CustomerPlanRecord = {
      ...plan,
      remainingVisits: progress.remainingVisits,
      scheduleState: progress.scheduleState,
      visitProgress: {
        totalVisits: progress.totalVisits,
        remainingVisits: progress.remainingVisits,
        completedVisits: progress.completedVisits,
        cancelledVisits: progress.cancelledVisits,
        missedVisits: progress.missedVisits,
        scheduledVisits: progress.scheduledVisits,
        unscheduledVisits: progress.unscheduledVisits,
        inProgressVisits: progress.inProgressVisits,
      },
      updatedAt: now,
      version: plan.version + 1,
    };

    try {
      await this.plans.completeVisitAndUpdatePlan({
        visit: completed,
        expectedVisitVersion: visit.version,
        plan: nextPlan,
        expectedPlanVersion: plan.version,
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        const latest = await this.requireVisit(plan.planId, visitId);
        if (latest.status === PACKAGE_VISIT_STATUS.COMPLETED && latest.entitlementConsumed) {
          return toVisitResponse(latest);
        }
        throw new ConflictError('Visit completion conflict; retry with the same idempotency key');
      }
      throw error;
    }

    this.logger.info({
      event: 'package_visit_completed',
      planId: plan.planId,
      visitId: visit.visitId,
      remainingVisits: progress.remainingVisits,
      completedBy: actor.staffId,
    });
    return toVisitResponse(completed);
  }

  /**
   * Vendor confirms schedules for multiple unscheduled visits.
   * Not globally atomic across Availability: processes sequentially, records PARTIAL
   * when some reservations fail, and never marks COMPLETE if any remain UNSCHEDULED.
   */
  async confirmSchedules(request: LambdaRequest): Promise<{
    planId: string;
    scheduleState: string;
    scheduled: PackageVisitResponse[];
    failed: Array<{ visitId: string; code: string; message: string }>;
  }> {
    const actor = resolveVisitActor(request);
    const planId = pathParam(request, 'planId');
    requireIdempotency(request);
    const plan = await this.requirePlanAccess(planId, actor);
    assertVendorStaffForPlan(actor, plan);
    this.assertPlanPaid(plan);

    const body = (request.body ?? {}) as { visits?: unknown };
    if (!Array.isArray(body.visits) || body.visits.length === 0) {
      throw new ValidationError('visits array is required');
    }

    await this.plans.savePlan(
      {
        ...plan,
        scheduleState: PACKAGE_SCHEDULE_STATE.IN_PROGRESS,
        updatedAt: new Date().toISOString(),
        version: plan.version + 1,
      },
      plan.version,
    ).catch(() => undefined);

    const scheduled: PackageVisitResponse[] = [];
    const failed: Array<{ visitId: string; code: string; message: string }> = [];

    for (const entry of body.visits) {
      const item = (entry ?? {}) as Record<string, unknown>;
      const visitId = typeof item.visitId === 'string' ? item.visitId.trim() : '';
      if (!visitId) {
        failed.push({ visitId: '', code: 'VALIDATION_ERROR', message: 'visitId is required' });
        continue;
      }
      try {
        const synthetic: LambdaRequest = {
          ...request,
          pathParameters: { ...(request.pathParameters ?? {}), planId, visitId },
          body: {
            date: item.date,
            startTime: item.startTime,
            timezone: item.timezone,
            branchId: item.branchId,
            durationMinutes: item.durationMinutes,
          },
        };
        scheduled.push(await this.schedule(synthetic));
      } catch (error) {
        failed.push({
          visitId,
          code: error instanceof BookingError ? error.code : 'SCHEDULE_FAILED',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const progress = await this.refreshPlanProgress(planId);
    const scheduleState = failed.length > 0
      ? PACKAGE_SCHEDULE_STATE.PARTIAL
      : progress.scheduleState;

    if (scheduleState !== progress.scheduleState) {
      const latest = await this.plans.getPlan(planId);
      if (latest) {
        await this.plans.savePlan(
          { ...latest, scheduleState, updatedAt: new Date().toISOString(), version: latest.version + 1 },
          latest.version,
        ).catch(() => undefined);
      }
    }

    return { planId, scheduleState, scheduled, failed };
  }

  async refreshPlanProgress(planId: string) {
    const plan = await this.plans.getPlan(planId);
    if (!plan) return computeVisitProgress([]);
    const visits = await this.plans.listVisits(planId);
    const progress = computeVisitProgress(visits);
    const now = new Date().toISOString();
    try {
      await this.plans.savePlan(
        {
          ...plan,
          remainingVisits: progress.remainingVisits,
          scheduleState: progress.scheduleState,
          visitProgress: {
            totalVisits: progress.totalVisits,
            remainingVisits: progress.remainingVisits,
            completedVisits: progress.completedVisits,
            cancelledVisits: progress.cancelledVisits,
            missedVisits: progress.missedVisits,
            scheduledVisits: progress.scheduledVisits,
            unscheduledVisits: progress.unscheduledVisits,
            inProgressVisits: progress.inProgressVisits,
          },
          ...(plan.activatedAt && plan.validityDays && !plan.validUntil
            ? { validUntil: validityEndsAt(plan.activatedAt, plan.validityDays) }
            : {}),
          updatedAt: now,
          version: plan.version + 1,
        },
        plan.version,
      );
    } catch {
      // Progress is denormalized; visit rows remain authoritative.
    }
    return progress;
  }

  private async requirePlanAccess(planId: string, actor: VisitActor): Promise<CustomerPlanRecord> {
    const plan = await this.plans.getPlan(planId);
    if (!plan) throw new NotFoundError(`Plan with ID ${planId} not found`);
    assertCustomerOrVendorForPlan(actor, plan);
    return plan;
  }

  private async requireVisit(planId: string, visitId: string): Promise<PackageVisitRecord> {
    const visit = await this.plans.getVisit(planId, visitId);
    if (!visit) throw new NotFoundError(`Visit ${visitId} not found`);
    return visit;
  }

  private assertPlanPaid(plan: CustomerPlanRecord): void {
    if (plan.paymentStatus !== 'PAID') {
      throw new BusinessRuleError('Package plan must be paid before scheduling visits');
    }
  }

  private async releaseQuietly(allocationId: string): Promise<void> {
    try {
      await this.availability.releaseAllocation(allocationId);
    } catch (error) {
      this.logger.error({
        event: 'package_visit_release_failed',
        allocationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function pathParam(request: LambdaRequest, name: string): string {
  const value = request.pathParameters?.[name]?.trim();
  if (!value) throw new ValidationError(`${name} is required`);
  return value;
}

function requireIdempotency(request: LambdaRequest): string {
  const key = headerValue(request, 'Idempotency-Key');
  if (!key || key.length > 128) {
    throw new ValidationError('Idempotency-Key header is required');
  }
  return key;
}

function sameSchedule(
  current: PackageVisitSchedule,
  next: { date: string; startTime: string; timezone: string; branchId: string },
): boolean {
  return current.date === next.date
    && current.startTime === next.startTime
    && current.timezone === next.timezone
    && current.branchId === next.branchId;
}

function decodeCursor(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new ValidationError('cursor is invalid');
  }
}

let service: PackageVisitsService;

export function getPackageVisitsService() {
  if (!service) service = new PackageVisitsService();
  return service;
}
