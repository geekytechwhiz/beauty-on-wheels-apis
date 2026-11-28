import { LambdaRequest } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { actorDetails } from '../auth/vendor-operations';
import { enrichVisitFromPlan } from '../domain/package-visit';
import {
  SUMMARY_VISIT_CAP,
  VendorHomeSummary,
  eachDate,
  parseHomeSummaryQuery,
  summarizeVendorHome,
} from '../domain/vendor-home-summary';
import { OPERATIONS_TIMEZONE } from '../domain/vendor-package-visits';
import { resolveVendorTimezone } from '../domain/vendor-operations-summary';
import { BookingError } from '../errors';
import { requestQuery } from '../http/request-query';
import {
  OperationalAccessGateway,
  getOperationalAccessGateway,
} from '../integrations/vendor.client';
import {
  BookingsRepository,
  getBookingsRepository,
} from '../repositories/bookings.repository';
import {
  CustomerPlansRepository,
  getCustomerPlansRepository,
} from '../repositories/customer-plans.repository';
import { CustomerPlanRecord } from '../types/customer-plan.types';
import { PackageVisitRecord } from '../types/package-visit.types';

const baseLogger = createLogger({ service: 'vendor-home-summary', redactPII: true });

/**
 * Read-only vendor dashboard for one civil day plus a short upcoming window.
 *
 * Reads:
 *   - PackageVisit via GSI3 per civil day (VENDOR#{vendorId}#DATE#{date})
 *   - One-time VendorBooking via GSI1 date BETWEEN (BOOKING#{date}#...), with
 *     planId filtered out so package first-job projections are not double-counted
 *
 * GSI2 is visit-id lookup only and is never used here. Does not call Vendor
 * Service for proposals or greetings. No meta.generatedAt (matches other
 * booking-service summary payloads).
 */
export class VendorHomeSummaryService {
  private readonly logger = createChildLogger(baseLogger, { service: 'VendorHomeSummaryService' });

  constructor(
    private readonly plans: CustomerPlansRepository = getCustomerPlansRepository(),
    private readonly bookings: BookingsRepository = getBookingsRepository(),
    private readonly vendors: OperationalAccessGateway = getOperationalAccessGateway(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async summary(request: LambdaRequest): Promise<VendorHomeSummary> {
    const vendorId = pathVendorId(request);
    await actorDetails(request, vendorId, this.vendors);

    const timezone = await this.resolveTimezone(vendorId);
    const range = parseHomeSummaryQuery(requestQuery(request), this.now(), timezone);
    const dates = eachDate(range.fromDate, range.toDate);

    const visits: PackageVisitRecord[] = [];
    for (const date of dates) {
      visits.push(...await this.plans.listVendorVisitsForDate(vendorId, date));
      if (visits.length > SUMMARY_VISIT_CAP) {
        throw new BookingError(
          'SUMMARY_TOO_LARGE',
          'Narrow the date range. Totals are not returned for a partial read.',
          409,
          'upcomingDays',
          false,
        );
      }
    }

    const bookings = await this.bookings.listVendorBookingsForDateRange(
      vendorId,
      range.fromDate,
      range.toDate,
    );
    if (visits.length + bookings.length > SUMMARY_VISIT_CAP) {
      throw new BookingError(
        'SUMMARY_TOO_LARGE',
        'Narrow the date range. Totals are not returned for a partial read.',
        409,
        'upcomingDays',
        false,
      );
    }

    const planCache = new Map<string, CustomerPlanRecord | null>();
    const enriched = await this.enrich(visits, planCache);
    const result = summarizeVendorHome({
      vendorId,
      timezone,
      date: range.date,
      upcomingDays: range.upcomingDays,
      visits: enriched,
      bookings,
    });

    this.logger.info({
      event: 'vendor_home_summary_read',
      vendorId,
      date: range.date,
      upcomingDays: range.upcomingDays,
      todayTotal: result.today?.visits?.total,
      todayBlocked: result.today?.visits?.blocked,
      todayUnassigned: result.today.crew.unassigned,
      oneTimeCount: bookings.filter((booking) => !booking.planId?.trim()).length,
      packageVisitCount: enriched.length,
    });
    return result;
  }

  /**
   * Prefer timezones already present on dated visits/bookings for this vendor.
   * Falls back to the Kochi MVP operations zone when no schedule timezone exists.
   * Does not use the device/phone timezone.
   */
  private async resolveTimezone(vendorId: string): Promise<string> {
    try {
      const sampled = await this.plans.sampleVendorVisitTimezone(vendorId)
        ?? await this.bookings.sampleVendorBookingTimezone(vendorId);
      return resolveVendorTimezone([sampled]);
    } catch (error) {
      if (error instanceof BookingError && error.code === 'VENDOR_TIMEZONE_UNRESOLVED') {
        return OPERATIONS_TIMEZONE;
      }
      throw error;
    }
  }

  private async enrich(
    visits: PackageVisitRecord[],
    cache: Map<string, CustomerPlanRecord | null>,
  ): Promise<PackageVisitRecord[]> {
    const missing = [...new Set(
      visits
        .filter((visit) => !visit.communityId || !visit.visitWindowId)
        .map((visit) => visit.planId),
    )];
    await Promise.all(missing.filter((planId) => !cache.has(planId)).map(async (planId) => {
      cache.set(planId, await this.plans.getPlan(planId));
    }));
    return visits.map((visit) => enrichVisitFromPlan(visit, cache.get(visit.planId)));
  }
}

function pathVendorId(request: LambdaRequest): string {
  return request.pathParameters?.vendorId?.trim() ?? '';
}

let service: VendorHomeSummaryService;

export function getVendorHomeSummaryService(): VendorHomeSummaryService {
  if (!service) service = new VendorHomeSummaryService();
  return service;
}
