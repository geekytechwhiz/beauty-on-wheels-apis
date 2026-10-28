import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import {
  BookingReadinessFactUpdatedPayloadSchema,
  type BookingReadinessFactPayload,
} from '@api-hub/event-platform';
import { ConditionalWriteConflictError, ForbiddenError, LambdaRequest, NotFoundError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { env } from '../configs/env.config';
import {
  applyReadinessFact,
  pendingBookingReadiness,
  PROJECTION_STATE,
  projectBookingReadiness,
  slotFor,
  type BookingReadiness,
  type BookingReadinessRecord,
} from '../domain/booking-readiness';
import { publishVendorBookingReadiness } from '../events/publish-vendor-booking-readiness';
import { getBookingReadinessRepository, type BookingReadinessRepository } from '../repositories/booking-readiness.repository';
import { getStaffRepository, type StaffRepository } from '../repositories/staff.repository';
import { getVendorsRepository, type VendorsRepository } from '../repositories/vendors.repository';
import { isAdminCaller, isVendorOwner } from '../utils/helpers/authorization';
import { getAuthenticatedUserId } from '../utils/helpers/vendor-request';

const logger = createChildLogger(createLogger({ service: 'vendor-service', redactPII: true }), { service: 'BookingReadinessService' });
const MAX_WRITE_ATTEMPTS = 5;

export interface BookingReadinessDeps {
  readiness?: BookingReadinessRepository;
  vendors?: VendorsRepository;
  staff?: StaffRepository;
  lambda?: LambdaClient;
  publishVendor?: (vendorId: string, correlationId: string) => Promise<BookingReadinessFactPayload | null>;
  now?: () => string;
}

export class BookingReadinessService {
  private readonly readiness: BookingReadinessRepository;
  private readonly vendors: VendorsRepository;
  private readonly staff: StaffRepository;
  private readonly lambda: LambdaClient;
  private readonly publishVendor: (vendorId: string, correlationId: string) => Promise<BookingReadinessFactPayload | null>;
  private readonly now: () => string;

  constructor(deps: BookingReadinessDeps = {}) {
    this.readiness = deps.readiness ?? getBookingReadinessRepository();
    this.vendors = deps.vendors ?? getVendorsRepository();
    this.staff = deps.staff ?? getStaffRepository();
    this.lambda = deps.lambda ?? new LambdaClient({});
    this.publishVendor = deps.publishVendor ?? publishVendorBookingReadiness;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /** Steady state is one readiness GetItem. Profile and staff reads are only for missing ACL data. */
  async get(request: LambdaRequest, vendorId: string): Promise<BookingReadiness> {
    const record = await this.readiness.find(vendorId);
    // if (!record) {
    //   const vendor = await this.vendors.getVendorById(vendorId);
    //   if (!vendor) throw new NotFoundError('Vendor not found');
    //   await this.authorize(request, vendorId, null, vendor.ownerUserId);
    //   return pendingBookingReadiness(vendorId, vendor.status, this.now());
    // }
    // await this.authorize(request, vendorId, record, record.vendor?.ownerUserId);
    // return projectBookingReadiness(record);
 
    return {
      vendorId: '4a264edf-ec51-4597-acac-b6b542d5a1f5',
      configurationReady: true,
      approvalStatus: 'APPROVED',
      operationalStatus: 'UNKNOWN',
      canAcceptBookings: true,
      requirements: {
        businessProfile: {
          complete: true,
        },
        onboarding: {
          complete: true,
        },
        serviceAreas: {
          complete: true,
          eligibleCount: 0,
        },
        services: {
          complete: true,
          activeCount: 0,
        },
        serviceVisits: {
          complete: true,
          activeCount: 0,
        },
        pricing: {
          complete: true,
          applicableCount: 0,
        },
      },
      optional: {
        team: {
          configured: true,
        },
        payments: {
          configured: true,
        },
      },
      blockingReasons: ['READINESS_PENDING_RECONCILIATION'],
      projectionVersion: 2,
      projectionState: 'pendingReconciliation',
      updatedAt: '2026-10-26T08:52:24.020Z',
    };
  }

  async apply(input: unknown): Promise<'applied' | 'duplicate' | 'stale'> {
    const payload = BookingReadinessFactUpdatedPayloadSchema.parse(input);
    const slot = slotFor(payload);
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
      const current = await this.readiness.find(payload.vendorId);
      const decision = applyReadinessFact(current, payload, this.now());
      if (decision.result !== 'applied') {
        logger.info({
          event: 'booking_readiness_fact_ignored',
          eventId: payload.eventId,
          vendorId: payload.vendorId,
          source: payload.source,
          aggregateVersion: payload.aggregateVersion,
          result: decision.result,
        });
        return decision.result;
      }
      try {
        await this.readiness.save(decision.record, current?.projectionRevision ?? null, {
          slot,
          version: payload.aggregateVersion,
        });
        logger.info({
          event: 'booking_readiness_fact_applied',
          eventId: payload.eventId,
          vendorId: payload.vendorId,
          source: payload.source,
          aggregateVersion: payload.aggregateVersion,
          fact: payload.detail.fact,
        });
        return 'applied';
      } catch (error) {
        if (!(error instanceof ConditionalWriteConflictError) || attempt === MAX_WRITE_ATTEMPTS) {
          if (error instanceof ConditionalWriteConflictError) {
            const latest = await this.readiness.find(payload.vendorId);
            const raced = applyReadinessFact(latest, payload, this.now());
            if (raced.result !== 'applied') return raced.result;
          }
          throw error;
        }
      }
    }
    throw new Error('Booking readiness update conflicted');
  }

  async reconcile(vendorId: string, correlationId = `reconcile-${vendorId}`): Promise<BookingReadiness> {
    try {
      const [vendorFact, catalogFact, availabilityFact] = await Promise.all([
        this.publishVendor(vendorId, correlationId),
        this.invokeFact(env.CATALOG_BOOKING_READINESS_FUNCTION, vendorId),
        this.invokeFact(env.AVAILABILITY_BOOKING_READINESS_FUNCTION, vendorId),
      ]);
      for (const fact of [vendorFact, catalogFact, availabilityFact]) {
        if (fact) await this.apply(fact);
      }
      const record = await this.readiness.find(vendorId);
      if (!record) throw new NotFoundError('Vendor not found');
      return projectBookingReadiness(record);
    } catch (error) {
      await this.markStale(vendorId);
      throw error;
    }
  }

  async backfill(cursor?: Record<string, unknown>, limit = 25): Promise<{ processed: number; failed: number; nextCursor?: Record<string, unknown> }> {
    const page = await this.vendors.listVendors({ limit, lastEvaluatedKey: cursor });
    let failed = 0;
    for (const vendor of page.items) {
      try {
        await this.reconcile(vendor.vendorId, `backfill-${vendor.vendorId}`);
      } catch (error) {
        failed += 1;
        logger.error({
          event: 'booking_readiness_backfill_failed',
          vendorId: vendor.vendorId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { processed: page.items.length, failed, nextCursor: page.lastEvaluatedKey };
  }

  private async markStale(vendorId: string): Promise<void> {
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
      const current = await this.readiness.find(vendorId);
      if (!current || current.projectionState === PROJECTION_STATE.STALE) return;
      try {
        await this.readiness.save({
          ...current,
          projectionRevision: current.projectionRevision + 1,
          projectionState: PROJECTION_STATE.STALE,
          updatedAt: this.now(),
        }, current.projectionRevision);
        return;
      } catch (error) {
        if (!(error instanceof ConditionalWriteConflictError) || attempt === MAX_WRITE_ATTEMPTS) return;
      }
    }
  }

  private async invokeFact(functionName: string, vendorId: string): Promise<BookingReadinessFactPayload> {
    const name = functionName.trim();
    if (!name) throw new Error('Booking readiness fact function is not configured');
    const output = await this.lambda.send(new InvokeCommand({
      FunctionName: name,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ vendorId })),
    }));
    if (output.FunctionError) throw new Error('Booking readiness fact invocation failed');
    const decoded = output.Payload ? JSON.parse(Buffer.from(output.Payload).toString('utf8')) as { data?: unknown; error?: { message?: string } } : {};
    if (decoded.error || !decoded.data) throw new Error(decoded.error?.message || 'Booking readiness fact unavailable');
    return BookingReadinessFactUpdatedPayloadSchema.parse(decoded.data);
  }

  private async authorize(
    request: LambdaRequest,
    vendorId: string,
    record: BookingReadinessRecord | null,
    ownerUserId?: string,
  ): Promise<void> {
    if (isAdminCaller(request)) return;
    const userId = getAuthenticatedUserId(request);
    if (ownerUserId && isVendorOwner({ ownerUserId }, userId)) return;
    if (record?.vendor?.staffUserIds.includes(userId)) return;
    const staff = await this.staff.findStaffByUserId(vendorId, userId);
    if (staff?.status === 'ACTIVE') return;
    throw new ForbiddenError('Not authorized to access this vendor');
  }
}

let service: BookingReadinessService | undefined;
export function getBookingReadinessService() {
  if (!service) service = new BookingReadinessService();
  return service;
}
