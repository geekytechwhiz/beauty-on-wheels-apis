import { randomUUID } from 'crypto';

import {
  ConditionalWriteConflictError,
  ConflictError,
  ForbiddenError,
  LambdaRequest,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { authorizationHeader, headerValue, requireCustomerId } from '../auth/access';
import {
  assertBranch,
  assertLocation,
  assertVehicleOwnership,
  assertVendorEligible,
} from '../domain/create-booking';
import {
  assertPackageSellable,
  assertPlanExpectedPrice,
  billingPeriodEndIso,
  billingPeriodToCadence,
  buildPlanPricingSnapshot,
  deriveEntitlements,
  mapIncludedServices,
  planRequestFingerprint,
  resolveVisitWindow,
  toPlanResponse,
  totalVisits,
} from '../domain/customer-plan';
import { BookingError } from '../errors';
import { CatalogPackageGateway, getCatalogPackageGateway } from '../integrations/catalog.client';
import { UserGateway, getUserGateway } from '../integrations/user.client';
import { VehicleGateway, getVehicleGateway } from '../integrations/vehicle.client';
import { VendorGateway, getVendorGateway } from '../integrations/vendor.client';
import {
  CustomerPlansRepository,
  getCustomerPlansRepository,
} from '../repositories/customer-plans.repository';
import { validateCreateCustomerPlan } from '../schemas/customer-plans.schema';
import {
  CustomerPlanIdempotencyItem,
  CustomerPlanRecord,
  CustomerPlanResponse,
} from '../types/customer-plan.types';

const baseLogger = createLogger({ service: 'customer-plans-service', redactPII: true });

export class CustomerPlansService {
  private readonly logger = createChildLogger(baseLogger, { service: 'CustomerPlansService' });

  constructor(
    private readonly plans: CustomerPlansRepository = getCustomerPlansRepository(),
    private readonly vehicles: VehicleGateway = getVehicleGateway(),
    private readonly vendors: VendorGateway = getVendorGateway(),
    private readonly users: UserGateway = getUserGateway(),
    private readonly packages: CatalogPackageGateway = getCatalogPackageGateway(),
  ) {}

  /**
   * Creates a PENDING_PAYMENT package plan. Does not reserve Availability slots;
   * visitWindowId is a catalog preference the provider coordinates against.
   * Final price comes from the offering vehicle price for the customer's vehicle.
   */
  async create(request: LambdaRequest): Promise<CustomerPlanResponse> {
    const customerId = requireCustomerId(request);
    const command = validateCreateCustomerPlan(request);
    const idempotencyKey = headerValue(request, 'Idempotency-Key');
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw new ValidationError('Idempotency-Key header is required');
    }
    const hash = planRequestFingerprint(command);
    const authHeader = authorizationHeader(request);

    const existing = await this.plans.getIdempotency(customerId, idempotencyKey);
    if (existing) return this.resume(existing, hash);

    const [vehicle, eligibility, profile, catalogPackage] = await Promise.all([
      this.vehicles.getVehicle(command.vehicleId, authHeader),
      this.vendors.getCheckoutEligibility(command.vendorId, command.branchId),
      this.users.getProfile(customerId, authHeader),
      this.packages.getPackage({
        packageId: command.offeringId,
        vendorId: command.vendorId,
        authorizationHeader: authHeader,
      }),
    ]);

    assertVehicleOwnership(vehicle, customerId, command.vehicleId);
    assertVendorEligible(eligibility.vendor, command.vendorId);
    assertBranch(eligibility.branch, command);
    assertLocation(command, eligibility.vendor, profile);
    if (command.location.addressId) {
      await this.users.assertAddress(customerId, command.location.addressId, authHeader);
    }
    assertPackageSellable(catalogPackage, command);
    const visitWindow = resolveVisitWindow(catalogPackage, command.visitWindowId);
    const pricingSnapshot = buildPlanPricingSnapshot(catalogPackage, vehicle.vehicleType);
    assertPlanExpectedPrice(command.expectedPrice, pricingSnapshot);

    const entitlements = deriveEntitlements(catalogPackage.items);
    const now = new Date().toISOString();
    const record: CustomerPlanRecord = {
      planId: randomUUID(),
      customerId,
      vendorId: command.vendorId,
      branchId: command.branchId,
      packageId: command.offeringId,
      offeringId: command.offeringId,
      packageName: catalogPackage.name,
      vehicleId: command.vehicleId,
      vehicleType: vehicle.vehicleType,
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      billingPeriod: catalogPackage.billingPeriod,
      cadence: billingPeriodToCadence(catalogPackage.billingPeriod),
      remainingVisits: totalVisits(entitlements),
      entitlements,
      includedServices: mapIncludedServices(catalogPackage),
      visitWindowId: command.visitWindowId,
      visitWindow,
      location: command.location,
      pricingSnapshot,
      autoRenew: command.autoRenew === true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.plans.createPlan(record, hash, idempotencyKey);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        const replay = await this.plans.getIdempotency(customerId, idempotencyKey);
        if (replay) return this.resume(replay, hash);
        throw new ConflictError('The plan request was processed concurrently; retry with the same idempotency key');
      }
      throw error;
    }

    this.logger.info({
      event: 'customer_plan_created',
      planId: record.planId,
      offeringId: record.offeringId,
      visitWindowId: record.visitWindowId,
      autoRenew: record.autoRenew,
    });
    return toPlanResponse(record);
  }

  /** Lists only the authenticated customer's plans, newest first. */
  async list(request: LambdaRequest): Promise<CustomerPlanResponse[]> {
    const customerId = requireCustomerId(request);
    const plans = await this.plans.listCustomerPlans(customerId);
    return plans.filter((plan) => plan.customerId === customerId).map(toPlanResponse);
  }

  async get(request: LambdaRequest): Promise<CustomerPlanResponse> {
    const customerId = requireCustomerId(request);
    const planId = request.pathParameters?.planId?.trim();
    if (!planId) throw new ValidationError('planId is required');
    const plan = await this.plans.getPlan(planId);
    if (!plan) throw new NotFoundError(`Plan with ID ${planId} not found`);
    if (plan.customerId !== customerId) {
      throw new ForbiddenError('Not authorized to access this plan');
    }
    return toPlanResponse(plan);
  }

  /**
   * Anchors billing to the server-recorded start of the first job.
   * Called when the linked booking transitions to IN_PROGRESS.
   */
  async markFirstJobStarted(planId: string, firstJobId: string, startedAt: string): Promise<CustomerPlanRecord | null> {
    const plan = await this.plans.getPlan(planId);
    if (!plan) return null;
    if (plan.firstJobId && plan.firstJobId !== firstJobId) {
      throw new BookingError(
        'FIRST_JOB_MISMATCH',
        'Booking is not the first job linked to this plan',
        409,
        'firstJobId',
        false,
      );
    }
    if (plan.status === 'ACTIVE' && plan.billingPeriodStart) {
      return plan;
    }
    if (plan.paymentStatus !== 'PAID') {
      throw new BookingError('PLAN_NOT_PAID', 'Plan must be paid before the first job can start billing', 409);
    }
    const next: CustomerPlanRecord = {
      ...plan,
      status: 'ACTIVE',
      firstJobId: firstJobId,
      billingPeriodStart: startedAt,
      billingPeriodEnd: billingPeriodEndIso(startedAt, plan.billingPeriod),
      updatedAt: startedAt,
      version: plan.version + 1,
      // autoRenew is stored as selected; renewal execution is out of scope here.
      autoRenew: plan.autoRenew === true,
    };
    return this.plans.savePlan(next, plan.version);
  }

  private async resume(record: CustomerPlanIdempotencyItem, hash: string): Promise<CustomerPlanResponse> {
    if (record.requestHash !== hash) {
      throw new BookingError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used for a different plan request',
        409,
        'Idempotency-Key',
      );
    }
    const plan = await this.plans.getPlan(record.planId);
    if (!plan) throw new NotFoundError(`Plan with ID ${record.planId} not found`);
    return toPlanResponse(plan);
  }
}

let service: CustomerPlansService;

export function getCustomerPlansService() {
  if (!service) service = new CustomerPlansService();
  return service;
}
