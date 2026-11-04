import { randomUUID } from 'crypto';

import { ConflictError, LambdaRequest, NotFoundError, ValidationError } from '@api-hub/utils';
import { createLogger } from '@api-hub/observability';

import {
  CategoriesRepository,
  getCategoriesRepository,
} from '../repositories/categories.repository';
import {
  getPlatformPackagesRepository,
  PlatformPackageRecord,
  PlatformPackagesRepository,
  PlatformPackageSalesControl,
} from '../repositories/platform-packages.repository';
import {
  CommunityDirectorySource,
  getCommunityDirectorySource,
} from '../integrations/community-directory';
import {
  VendorCapacityCommitmentSource,
  getVendorCapacityCommitmentSource,
} from '../integrations/vendor-capacity-commitments';
import {
  VendorCoverageSource,
  getVendorCoverageSource,
} from '../integrations/vendor-coverage';
import {
  approvalActor,
  assertCatalogAdmin,
} from '../utils/helpers/catalog-admin';
import {
  PlatformPackagePatch,
  SalesControlInput,
  validatePlatformPackage,
  validatePlatformPackagePatch,
  validateSalesControl,
} from '../schemas/platform-packages.schema';

const salesLogger = createLogger({ service: 'platform-packages', redactPII: true });
const SALES_PACKAGE_CAP = 200;

const transitions: Record<
  PlatformPackageRecord['status'],
  readonly PlatformPackageRecord['status'][]
> = {
  draft: ['published', 'archived'],
  published: ['paused', 'archived', 'draft'],
  paused: ['published', 'archived', 'draft'],
  archived: [],
};

export class PlatformPackagesService {
  constructor(
    private readonly packages: PlatformPackagesRepository = getPlatformPackagesRepository(),
    private readonly categories: CategoriesRepository = getCategoriesRepository(),
    private readonly directory: CommunityDirectorySource = getCommunityDirectorySource(),
    private readonly coverage: VendorCoverageSource = getVendorCoverageSource(),
    private readonly commitments: VendorCapacityCommitmentSource = getVendorCapacityCommitmentSource(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async listAdmin(request: LambdaRequest) {
    assertCatalogAdmin(request);
    const query = { ...(request.query ?? {}), ...(request.params ?? {}) };
    const limit = query.limit === undefined ? 25 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ConflictError('limit must be between 1 and 100');
    const status = typeof query.status === 'string' ? query.status : undefined;
    const categoryId =
      typeof query.categoryId === 'string' ? query.categoryId : undefined;
    const token =
      typeof query.nextToken === 'string'
        ? decodeToken(query.nextToken)
        : undefined;
    const page = await this.packages.list({
      categoryId,
      status,
      limit,
      lastEvaluatedKey: token,
    });
    let items = page.items;
    if (typeof query.search === 'string' && query.search.trim()) {
      const needle = query.search.trim().toLowerCase();
      items = items.filter((row) =>
        `${row.name} ${row.description ?? ''}`.toLowerCase().includes(needle),
      );
    }
    const billingPeriod =
      typeof query.billingPeriod === 'string'
        ? query.billingPeriod
        : typeof query.cadence === 'string'
          ? query.cadence
          : undefined;
    if (billingPeriod)
      items = items.filter(
        (row) =>
          (row.billingPeriod ??
            (row as { billingCadence?: string }).billingCadence) ===
          billingPeriod,
      );
    items.sort((a, b) =>
      Number(
        query.sort === 'name'
          ? a.name.localeCompare(b.name)
          : a.displayOrder - b.displayOrder,
      ),
    );
    return {
      items: items.map(toResponse),
      total: items.length,
      ...(page.lastEvaluatedKey
        ? {
            nextToken: Buffer.from(
              JSON.stringify(page.lastEvaluatedKey),
            ).toString('base64url'),
          }
        : {}),
    };
  }

  async create(request: LambdaRequest) {
    assertCatalogAdmin(request);
    const body = validatePlatformPackage(request);
    await this.assertCategories(body);
    const actor = approvalActor(request);
    const now = this.now();
    const packageId = `pkg_${randomUUID()}`;
    const record: PlatformPackageRecord = {
      PK: `PLATFORM_PACKAGE#${packageId}`,
      SK: 'META',
      entityType: 'PlatformPackage',
      packageId,
      name: body.name,
      ...(body.description === undefined ? {} : { description: body.description }),
      categoryId: body.categoryId,
      billingPeriod: body.billingPeriod,
      currency: body.currency,
      displayOrder: body.displayOrder,
      status: body.status,
      includedServices: body.includedServices,
      vehiclePricing: body.vehiclePricing,
      ...(body.visitWindows === undefined ? {} : { visitWindows: body.visitWindows }),
      version: 1,
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor,
    };
    await this.packages.create(record);
    return toResponse(record);
  }

  async get(request: LambdaRequest) {
    assertCatalogAdmin(request);
    const record = await this.requirePackage(id(request, 'packageId'));
    const [history, salesControls] = await Promise.all([
      this.packages.listRevisions(record.packageId),
      this.packages.listSalesControls(record.packageId),
    ]);
    return {
      ...toResponse(record),
      history: history.sort((a, b) => b.version - a.version).map(toResponse),
      salesControls: salesControls.map(toSalesResponse),
    };
  }

  async patch(request: LambdaRequest) {
    assertCatalogAdmin(request);
    const packageId = id(request, 'packageId');
    const patch = validatePlatformPackagePatch(request);
    const current = await this.requirePackage(packageId);
    if (current.status === 'archived')
      throw new ConflictError('Archived packages cannot be edited');
    if (patch.expectedVersion !== current.version)
      throw new ConflictError('Package version conflict. Refresh and retry.');
    if (
      patch.status !== undefined &&
      patch.status !== 'draft' &&
      patch.status !== current.status
    )
      throw new ConflictError(
        'Use publish, pause, resume, or archive to change package status',
      );
    await this.assertCategories(patch);
    const next = this.merge(current, patch, approvalActor(request));
    await this.save(next, current.version);
    return toResponse(next);
  }

  async transition(
    request: LambdaRequest,
    target: PlatformPackageRecord['status'],
  ) {
    assertCatalogAdmin(request);
    const packageId = id(request, 'packageId');
    const expectedVersion = expected(request);
    const current = await this.requirePackage(packageId);
    if (current.version !== expectedVersion)
      throw new ConflictError('Package version conflict. Refresh and retry.');
    if (!transitions[current.status].includes(target))
      throw new ConflictError(
        `Cannot transition package from ${current.status} to ${target}`,
      );
    if (target === 'published') await this.assertPublishable(current);
    const now = this.now();
    const actor = approvalActor(request);
    const next: PlatformPackageRecord = {
      ...current,
      status: target,
      version: current.version + 1,
      ...(target === 'published'
        ? { publishedVersion: current.version + 1 }
        : {}),
      updatedAt: now,
      updatedBy: actor,
    };
    await this.save(next, current.version);
    return toResponse(next);
  }

  async updateSalesControl(request: LambdaRequest) {
    assertCatalogAdmin(request);
    const packageId = id(request, 'packageId');
    const communityId = id(request, 'communityId');
    const input = validateSalesControl(request);
    const packageRow = await this.requirePackage(packageId);
    const actor = approvalActor(request);
    const current = await this.packages.getSalesControl(packageId, communityId);
    if (current && input.expectedVersion !== current.version)
      throw new ConflictError(
        'Sales-control version conflict. Refresh and retry.',
      );
    if (!current && input.expectedVersion !== undefined)
      throw new ConflictError(
        'Sales-control version conflict. Refresh and retry.',
      );
    if (input.enabled) {
      await this.assertSalesPrerequisites(packageId, communityId, input);
    }
    const now = this.now();
    const sales: PlatformPackageSalesControl = {
      PK: packageRow.PK,
      SK: `SALES#${communityId}`,
      entityType: 'PlatformPackageSalesControl',
      packageId,
      categoryId: packageRow.categoryId,
      communityId,
      enabled: input.enabled,
      reason: input.reason,
      fulfilmentVendorIds: input.fulfilmentVendorIds,
      capacityCommitmentIds: input.capacityCommitmentIds,
      ...(input.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}),
      ...(input.effectiveUntil ? { effectiveUntil: input.effectiveUntil } : {}),
      version: (current?.version ?? 0) + 1,
      createdAt: current?.createdAt ?? now,
      createdBy: current?.createdBy ?? actor,
      updatedAt: now,
      updatedBy: actor,
      ...(input.enabled
        ? {
            GSI3PK: `COMMUNITY#${communityId}`,
            GSI3SK: `PLATFORM_PACKAGE#${packageRow.categoryId}#${packageId}`,
          }
        : {}),
    };
    await this.packages.saveSalesControl(sales, current?.version);
    return toSalesResponse(sales);
  }

  /**
   * GET /admin/sales-controls.
   * Reads stored sales-control rows. It does not change packages, vendor capabilities, or community approval.
   */
  async listSalesControls(request: LambdaRequest) {
    const started = Date.now();
    assertCatalogAdmin(request);
    const query = { ...(request.query ?? {}), ...(request.params ?? {}) };
    const limit = query.limit === undefined ? 25 : Number(query.limit);
    const offset = query.offset === undefined ? 0 : Number(query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ValidationError('limit must be an integer from 1 to 100');
    }
    if (!Number.isInteger(offset) || offset < 0) throw new ValidationError('offset must be a non-negative integer');
    const packageId = text(query.packageId);
    const communityId = text(query.communityId);
    const status = text(query.status);
    if (status && !SALES_STATUS_FILTERS.has(status)) {
      throw new ValidationError('status must be open, held, scheduled, expired, enabled, or disabled');
    }
    const packages = packageId
      ? [await this.requirePackage(packageId)]
      : await this.packages.listAllIndex();
    if (packages.length > SALES_PACKAGE_CAP) {
      throw new ConflictError('Too many packages to list every sales control. Pass packageId.');
    }
    const controls = (
      await Promise.all(packages.map(async (row) => {
        const rows = await this.packages.listSalesControls(row.packageId);
        return rows.map((control) => ({ control, packageName: row.name }));
      }))
    ).flat();
    const now = this.now();
    const filtered = controls
      .filter((row) => !communityId || row.control.communityId === communityId)
      .filter((row) => !status || matchesSalesStatus(row.control, status, now))
      .sort((left, right) => {
        const byTime = right.control.updatedAt.localeCompare(left.control.updatedAt);
        if (byTime !== 0) return byTime;
        return `${left.control.packageId}:${left.control.communityId}`.localeCompare(
          `${right.control.packageId}:${right.control.communityId}`,
        );
      });
    const page = filtered.slice(offset, offset + limit);
    const hasMore = offset + page.length < filtered.length;
    salesLogger.info({
      event: 'admin_sales_controls_listed',
      correlationId: (request.context as { correlationId?: string } | undefined)?.correlationId,
      service: 'service-catalog-service',
      operation: 'GET /admin/sales-controls',
      outcome: 'success',
      durationMs: Date.now() - started,
      count: page.length,
      total: filtered.length,
      packageId,
      communityId,
    });
    return {
      items: page.map((row) => ({
        ...toSalesResponse(row.control),
        packageName: row.packageName,
        eligibility: salesEligibility(row.control, now),
      })),
      total: filtered.length,
      pagination: {
        limit,
        offset,
        nextOffset: hasMore ? offset + page.length : null,
        hasMore,
        totalAvailability: 'complete' as const,
        totalReason: 'total is the filtered sales-control population, not the page length.',
      },
    };
  }

  /** Customer-facing discovery. Reads only published packages with an enabled, current sales control. */
  async discover(request: LambdaRequest) {
    const query = { ...(request.query ?? {}), ...(request.params ?? {}) };
    const communityId =
      typeof query.communityId === 'string' ? query.communityId.trim() : '';
    if (!communityId) throw new NotFoundError('communityId is required');
    const categoryId =
      typeof query.categoryId === 'string'
        ? query.categoryId.trim()
        : undefined;
    const controls = await this.packages.listEnabledForCommunity(
      communityId,
      categoryId,
    );
    const now = this.now();
    const rows = await Promise.all(
      controls
        .filter((item) => effective(item, now))
        .map(async (control) => {
          const current = await this.packages.getPackage(control.packageId);
          if (
            !current ||
            current.status === 'archived' ||
            current.status === 'paused' ||
            !current.publishedVersion
          )
            return null;
          const published = await this.packages.getRevision(
            current.packageId,
            current.publishedVersion,
          );
          return published?.status === 'published' ? published : null;
        }),
    );
    const items = rows
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .map(toCustomerResponse);
    return { items, total: items.length };
  }

  /** Customer purchase read; community is required so sales-control is enforced again at checkout. */
  async getCustomerPackage(request: LambdaRequest) {
    const packageId = id(request, 'packageId');
    const query = { ...(request.query ?? {}), ...(request.params ?? {}) };
    const communityId =
      typeof query.communityId === 'string' ? query.communityId.trim() : '';
    if (!communityId) throw new NotFoundError('communityId is required');
    const [current, control] = await Promise.all([
      this.requirePackage(packageId),
      this.packages.getSalesControl(packageId, communityId),
    ]);
    if (
      !control ||
      !effective(control, this.now()) ||
      current.status === 'paused' ||
      current.status === 'archived' ||
      !current.publishedVersion
    )
      throw new NotFoundError(`Package not available: ${packageId}`);
    const published = await this.packages.getRevision(
      packageId,
      current.publishedVersion,
    );
    if (!published || published.status !== 'published')
      throw new NotFoundError(`Package not available: ${packageId}`);
    return {
      ...toCustomerResponse(published),
      fulfilmentVendorIds: control.fulfilmentVendorIds,
    };
  }

  private async assertCategories(body: {
    categoryId?: string;
    includedServices?: ReadonlyArray<{ categoryId: string }>;
  }) {
    const ids = new Set<string>();
    if (body.categoryId) ids.add(body.categoryId);
    for (const item of body.includedServices ?? []) ids.add(item.categoryId);
    for (const categoryId of ids) {
      const category = await this.categories.findById(categoryId);
      if (!category)
        throw new NotFoundError(`Category not found: ${categoryId}`);
      if (!category.active)
        throw new ConflictError(`Category is not active: ${categoryId}`);
    }
  }
  private async assertPublishable(record: PlatformPackageRecord) {
    await this.assertCategories(record);
    if (!record.includedServices.length || !record.vehiclePricing.length)
      throw new ConflictError('Package is incomplete and cannot be published');
  }
  /**
   * Opening checkout requires an active community, approved vendor coverage, and
   * linked commitments that still hold supply for this community. Proposal accept
   * alone never enables sales; this gate is the only write path that opens them.
   */
  private async assertSalesPrerequisites(
    packageId: string,
    communityId: string,
    input: SalesControlInput,
  ) {
    const active = await this.directory.activeCommunityIds([communityId]);
    if (!active.includes(communityId))
      throw new ConflictError(`Community is not active: ${communityId}`);
    const fulfilmentVendors = new Set(input.fulfilmentVendorIds);
    for (const vendorId of fulfilmentVendors) {
      const communities = await this.coverage.activeCommunityIds(vendorId);
      if (!communities.includes(communityId))
        throw new ConflictError(
          `Vendor ${vendorId} has no approved community coverage`,
        );
    }
    const facts = await this.commitments.lookup(input.capacityCommitmentIds);
    const byId = new Map(facts.map((fact) => [fact.commitmentId, fact]));
    for (const commitmentId of input.capacityCommitmentIds) {
      const fact = byId.get(commitmentId);
      if (!fact) {
        throw new ConflictError(
          `Capacity commitment not found: ${commitmentId}`,
        );
      }
      if (!fact.holdsCapacity) {
        throw new ConflictError(
          `Capacity commitment ${commitmentId} is ${fact.status} and cannot open sales`,
        );
      }
      if (fact.communityId !== communityId) {
        throw new ConflictError(
          `Capacity commitment ${commitmentId} covers community ${fact.communityId}, not ${communityId}`,
        );
      }
      if (!fulfilmentVendors.has(fact.vendorId)) {
        throw new ConflictError(
          `Capacity commitment ${commitmentId} belongs to vendor ${fact.vendorId}, which is not in fulfilmentVendorIds`,
        );
      }
      if (fact.scope.offeringId && fact.scope.offeringId !== packageId) {
        throw new ConflictError(
          `Capacity commitment ${commitmentId} is scoped to package ${fact.scope.offeringId}, not ${packageId}`,
        );
      }
    }
    const linkedVendors = new Set(facts.map((fact) => fact.vendorId));
    for (const vendorId of fulfilmentVendors) {
      if (!linkedVendors.has(vendorId)) {
        throw new ConflictError(
          `Fulfilment vendor ${vendorId} has no linked capacity commitment for this sales control`,
        );
      }
    }
  }
  private merge(
    current: PlatformPackageRecord,
    patch: PlatformPackagePatch,
    actor: string,
  ): PlatformPackageRecord {
    const { expectedVersion: _expected, status: _status, ...changes } = patch;
    return {
      ...current,
      ...changes,
      status:
        current.status === 'published' || current.status === 'paused'
          ? 'draft'
          : current.status,
      version: current.version + 1,
      updatedAt: this.now(),
      updatedBy: actor,
    };
  }
  private async save(record: PlatformPackageRecord, version: number) {
    try {
      await this.packages.save(record, version);
    } catch (error) {
      throw new ConflictError(
        'Package was modified concurrently. Refresh and retry.',
      );
    }
  }
  private async requirePackage(packageId: string) {
    const record = await this.packages.getPackage(packageId);
    if (!record) throw new NotFoundError(`Package not found: ${packageId}`);
    return record;
  }
}

function id(request: LambdaRequest, name: string) {
  const value = request.pathParameters?.[name] ?? request.params?.[name];
  if (typeof value !== 'string' || !value.trim())
    throw new NotFoundError(`${name} is required`);
  return value.trim();
}
function expected(request: LambdaRequest) {
  const value = (request.body as { expectedVersion?: unknown } | undefined)
    ?.expectedVersion;
  if (!Number.isInteger(value) || (value as number) < 1)
    throw new ConflictError('expectedVersion is required');
  return value as number;
}
function decodeToken(token: string) {
  try {
    return JSON.parse(
      Buffer.from(token, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
  } catch {
    throw new ConflictError('nextToken is invalid');
  }
}
const SALES_STATUS_FILTERS = new Set(['open', 'held', 'scheduled', 'expired', 'enabled', 'disabled']);

export function salesEligibility(
  control: Pick<PlatformPackageSalesControl, 'enabled' | 'effectiveFrom' | 'effectiveUntil'>,
  now: string,
): 'open' | 'held' | 'scheduled' | 'expired' {
  if (!control.enabled) return 'held';
  if (control.effectiveFrom && control.effectiveFrom > now) return 'scheduled';
  if (control.effectiveUntil && control.effectiveUntil <= now) return 'expired';
  return 'open';
}

function matchesSalesStatus(
  control: PlatformPackageSalesControl,
  status: string,
  now: string,
): boolean {
  if (status === 'enabled') return control.enabled;
  if (status === 'disabled') return !control.enabled;
  return salesEligibility(control, now) === status;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function effective(control: PlatformPackageSalesControl, now: string) {
  return (
    control.enabled &&
    (!control.effectiveFrom || control.effectiveFrom <= now) &&
    (!control.effectiveUntil || control.effectiveUntil > now)
  );
}
function toResponse(
  row:
    | PlatformPackageRecord
    | (Omit<PlatformPackageRecord, 'entityType'> & { entityType: string }),
) {
  const stored = row as PlatformPackageRecord & {
    billingCadence?: PlatformPackageRecord['billingPeriod'];
    validityDays?: number;
    retailPricing?: Array<{
      vehicleType: string;
      priceMinor?: number;
      price?: number;
      durationMinutes?: number;
    }>;
    includedServices: Array<
      PlatformPackageRecord['includedServices'][number] & {
        name?: string;
        visitsPerCadence?: number;
        tags?: string[];
      }
    >;
  };
  const {
    PK: _pk,
    SK: _sk,
    entityType: _entity,
    billingCadence: _billingCadence,
    validityDays: _validityDays,
    retailPricing: _retailPricing,
    vehiclePricing: _vehiclePricing,
    includedServices: _includedServices,
    ...data
  } = stored;
  const priceRows = Array.isArray(stored.vehiclePricing)
    ? stored.vehiclePricing
    : Array.isArray(stored.retailPricing)
      ? stored.retailPricing
      : [];
  const vehiclePricing = priceRows.map((entry) => {
    const price = entry as {
      vehicleType?: string;
      price?: number;
      priceMinor?: number;
      durationMinutes?: number;
    };
    return {
      vehicleType: price.vehicleType ?? '',
      price: price.price ?? price.priceMinor ?? 0,
      ...(price.durationMinutes === undefined
        ? {}
        : { durationMinutes: price.durationMinutes }),
    };
  });
  const includedServices = stored.includedServices.map((entry) => {
    const item = entry as PlatformPackageRecord['includedServices'][number] & {
      visitsPerCadence?: number;
    };
    return {
      name: item.name ?? item.serviceKey,
      serviceKey: item.serviceKey,
      categoryId: item.categoryId,
      ...(item.description === undefined ? {} : { description: item.description }),
      visitsPerPeriod: item.visitsPerPeriod ?? item.visitsPerCadence ?? 0,
      durationMinutes: item.durationMinutes,
    };
  });
  return {
    ...data,
    billingPeriod: stored.billingPeriod ?? stored.billingCadence,
    includedServices,
    vehiclePricing,
  };
}
function toSalesResponse(row: PlatformPackageSalesControl) {
  const {
    PK: _pk,
    SK: _sk,
    entityType: _entity,
    GSI3PK: _gsiPk,
    GSI3SK: _gsiSk,
    ...data
  } = row;
  return data;
}
function toCustomerResponse(
  row:
    | PlatformPackageRecord
    | (Omit<PlatformPackageRecord, 'entityType'> & { entityType: string }),
) {
  const {
    createdBy: _createdBy,
    updatedBy: _updatedBy,
    ...data
  } = toResponse(row);
  return {
    ...data,
    packageVersion: row.publishedVersion ?? row.version,
    entitlements: data.includedServices,
  };
}

let service: PlatformPackagesService | undefined;
export function getPlatformPackagesService() {
  if (!service) service = new PlatformPackagesService();
  return service;
}
