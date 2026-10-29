import { LambdaRequest } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { assertVendorOperationsAccess } from '../auth/vendor-operations';
import { enrichVisitFromPlan } from '../domain/package-visit';
import {
  SUMMARY_VISIT_CAP,
  VendorPackageVisitItem,
  VendorVisitSummary,
  decodeVisitToken,
  eachDate,
  encodeVisitToken,
  parseSummaryRange,
  parseVendorVisitQuery,
  summarizeVendorVisits,
  toVendorPackageVisit,
  visitMatchesFilters,
} from '../domain/vendor-package-visits';
import { BookingError } from '../errors';
import {
  OperationalAccessGateway,
  getOperationalAccessGateway,
} from '../integrations/vendor.client';
import {
  CustomerPlansRepository,
  getCustomerPlansRepository,
} from '../repositories/customer-plans.repository';
import { CustomerPlanRecord } from '../types/customer-plan.types';
import { PackageVisitRecord } from '../types/package-visit.types';

const baseLogger = createLogger({ service: 'vendor-package-visits', redactPII: true });
const PAGE_READ = 40;
const MAX_READS = 8;

export class VendorPackageVisitsService {
  private readonly logger = createChildLogger(baseLogger, { service: 'VendorPackageVisitsService' });

  constructor(
    private readonly plans: CustomerPlansRepository = getCustomerPlansRepository(),
    private readonly vendors: OperationalAccessGateway = getOperationalAccessGateway(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(request: LambdaRequest): Promise<{ items: VendorPackageVisitItem[]; nextToken: string | null }> {
    const vendorId = pathVendorId(request);
    await assertVendorOperationsAccess(request, vendorId, this.vendors);
    const query = parseVendorVisitQuery(request.queryStringParameters, this.now());
    const cursor = decodeVisitToken(request.queryStringParameters?.nextToken ?? undefined);
    const plans = new Map<string, CustomerPlanRecord | null>();
    const items: VendorPackageVisitItem[] = [];
    let exclusiveStartKey = cursor;
    let nextToken: string | null = null;

    for (let read = 0; read < MAX_READS && items.length < query.limit; read += 1) {
      const page = await this.plans.queryVendorScheduledVisits({
        vendorId,
        fromDate: query.fromDate,
        toDate: query.toDate,
        limit: PAGE_READ,
        ...(exclusiveStartKey ? { exclusiveStartKey } : {}),
      });
      const enriched = await this.enrich(page.items.map((row) => row.record), plans);
      let filled = false;
      for (let index = 0; index < enriched.length; index += 1) {
        const visit = enriched[index];
        if (!visitMatchesFilters(visit, query)) continue;
        items.push(toVendorPackageVisit(visit));
        if (items.length >= query.limit) {
          const moreInPage = index < enriched.length - 1;
          nextToken = moreInPage
            ? encodeVisitToken(page.items[index]?.resumeKey)
            : encodeVisitToken(page.lastEvaluatedKey);
          filled = true;
          break;
        }
      }
      if (filled) break;
      if (!page.lastEvaluatedKey) {
        nextToken = null;
        break;
      }
      exclusiveStartKey = page.lastEvaluatedKey;
      nextToken = encodeVisitToken(page.lastEvaluatedKey);
    }

    this.logger.info({
      event: 'vendor_package_visits_listed',
      vendorId,
      fromDate: query.fromDate,
      toDate: query.toDate,
      count: items.length,
    });
    return { items, nextToken };
  }

  async summary(request: LambdaRequest): Promise<VendorVisitSummary> {
    const vendorId = pathVendorId(request);
    await assertVendorOperationsAccess(request, vendorId, this.vendors);
    const range = parseSummaryRange(request.queryStringParameters, this.now());
    const visits: PackageVisitRecord[] = [];
    for (const date of eachDate(range.fromDate, range.toDate)) {
      const day = await this.plans.listVendorVisitsForDate(vendorId, date);
      visits.push(...day);
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
    const plans = new Map<string, CustomerPlanRecord | null>();
    const enriched = await this.enrich(visits, plans);
    return summarizeVendorVisits({
      visits: enriched,
      today: range.today,
      fromDate: range.fromDate,
      toDate: range.toDate,
    });
  }

  private async enrich(
    visits: PackageVisitRecord[],
    cache: Map<string, CustomerPlanRecord | null>,
  ): Promise<PackageVisitRecord[]> {
    const missing = [...new Set(visits.filter((visit) => !visit.communityId || !visit.visitWindowId).map((visit) => visit.planId))];
    await Promise.all(missing.filter((planId) => !cache.has(planId)).map(async (planId) => {
      cache.set(planId, await this.plans.getPlan(planId));
    }));
    return visits.map((visit) => enrichVisitFromPlan(visit, cache.get(visit.planId)));
  }
}

function pathVendorId(request: LambdaRequest): string {
  return request.pathParameters?.vendorId?.trim()
    ?? '';
}

let service: VendorPackageVisitsService;

export function getVendorPackageVisitsService() {
  if (!service) service = new VendorPackageVisitsService();
  return service;
}
