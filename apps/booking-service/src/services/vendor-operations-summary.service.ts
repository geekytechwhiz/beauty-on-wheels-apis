import { LambdaRequest } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { assertVendorOperationsAccess } from '../auth/vendor-operations';
import { enrichVisitFromPlan } from '../domain/package-visit';
import {
  SUMMARY_VISIT_CAP,
  VendorOperationsSummary,
  eachDate,
  oneTimeBookingToWorkUnit,
  packageVisitToWorkUnit,
  parseOperationsSummaryRange,
  resolveVendorTimezone,
  summarizeVendorOperations,
} from '../domain/vendor-operations-summary';
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
import { Booking } from '../types/api-types';
import { CustomerPlanRecord } from '../types/customer-plan.types';
import { PackageVisitRecord } from '../types/package-visit.types';

const baseLogger = createLogger({ service: 'vendor-operations-summary', redactPII: true });

/**
 * Read-only owner/admin dashboard totals for package visits and one-time bookings.
 * Does not create, update, or delete any booking or visit rows.
 */
export class VendorOperationsSummaryService {
  private readonly logger = createChildLogger(baseLogger, { service: 'VendorOperationsSummaryService' });

  constructor(
    private readonly plans: CustomerPlansRepository = getCustomerPlansRepository(),
    private readonly bookings: BookingsRepository = getBookingsRepository(),
    private readonly vendors: OperationalAccessGateway = getOperationalAccessGateway(),
  ) {}

  async summary(request: LambdaRequest): Promise<VendorOperationsSummary> {
    const vendorId = pathVendorId(request);
    await assertVendorOperationsAccess(request, vendorId, this.vendors);
    const range = parseOperationsSummaryRange(requestQuery(request));

    const visits: PackageVisitRecord[] = [];
    for (const date of eachDate(range.fromDate, range.toDate)) {
      visits.push(...await this.plans.listVendorVisitsForDate(vendorId, date));
      if (visits.length > SUMMARY_VISIT_CAP) {
        throw new BookingError(
          'SUMMARY_TOO_LARGE',
          'Narrow the date range. Totals are not returned for a partial read.',
          409,
          'toDate',
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
        'toDate',
        false,
      );
    }

    const planCache = new Map<string, CustomerPlanRecord | null>();
    const enriched = await this.enrich(visits, planCache);
    const timezone = await this.resolveTimezone(vendorId, enriched, bookings);
    const result = summarizeVendorOperations({
      visits: enriched,
      bookings,
      fromDate: range.fromDate,
      toDate: range.toDate,
      timezone,
    });

    this.logger.info({
      event: 'vendor_operations_summary_read',
      vendorId,
      fromDate: range.fromDate,
      toDate: range.toDate,
      expected: result.metrics.expected,
      oneTimeCount: bookings.filter((booking) => oneTimeBookingToWorkUnit(booking)).length,
      packageVisitCount: enriched.filter((visit) => packageVisitToWorkUnit(visit)).length,
    });
    return result;
  }

  private async resolveTimezone(
    vendorId: string,
    visits: readonly PackageVisitRecord[],
    bookings: readonly Booking[],
  ): Promise<string> {
    const inRange = [
      ...visits.map((visit) => visit.schedule?.timezone),
      ...bookings.map((booking) => booking.schedule?.timezone),
    ];
    try {
      return resolveVendorTimezone(inRange);
    } catch (error) {
      if (!(error instanceof BookingError) || error.code !== 'VENDOR_TIMEZONE_UNRESOLVED') {
        throw error;
      }
    }
    const sampled = await this.plans.sampleVendorVisitTimezone(vendorId)
      ?? await this.bookings.sampleVendorBookingTimezone(vendorId);
    return resolveVendorTimezone([sampled]);
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

let service: VendorOperationsSummaryService;

export function getVendorOperationsSummaryService(): VendorOperationsSummaryService {
  if (!service) service = new VendorOperationsSummaryService();
  return service;
}
