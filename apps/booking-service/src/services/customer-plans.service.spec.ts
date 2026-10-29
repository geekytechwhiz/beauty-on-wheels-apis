import { ConditionalWriteConflictError, LambdaRequest } from '@api-hub/utils';

import { CustomerPlansService } from './customer-plans.service';
import { CatalogPackage, CatalogPackageGateway } from '../integrations/catalog.client';
import { UserGateway } from '../integrations/user.client';
import { VehicleGateway } from '../integrations/vehicle.client';
import { VendorGateway } from '../integrations/vendor.client';
import { CustomerPlansRepository } from '../repositories/customer-plans.repository';
import { CustomerPlanRecord } from '../types/customer-plan.types';
import { planRequestFingerprint } from '../domain/customer-plan';
import { validateCreateCustomerPlan } from '../schemas/customer-plans.schema';

const command = {
  vendorId: 'vendor_1',
  offeringId: 'pkg_weekly_wash',
  vehicleId: 'veh_1',
  location: { fulfilmentType: 'community', communityId: 'comm_1' },
  visitWindowId: 'morning',
  autoRenew: true,
  expectedPrice: { totalMinor: 1999, currency: 'INR' },
};

const catalogPackage: CatalogPackage = {
  id: 'pkg_weekly_wash',
  vendorId: 'vendor_1',
  name: 'Weekly Wash',
  active: true,
  billingPeriod: 'weekly',
  discountedPrice: 1999,
  currency: 'INR',
  version: 3,
  vehiclePricing: [
    { vehicleType: 'SEDAN', price: 1999, durationMinutes: 170 },
    { vehicleType: 'SUV', price: 2499, durationMinutes: 200 },
  ],
  vehicleTypes: ['SEDAN', 'SUV'],
  includedServices: [
    { name: 'svc_wash', categoryId: 'cat_wash', visitsPerPeriod: 2, durationMinutes: 30 },
    { name: 'svc_wax', categoryId: 'cat_detail', visitsPerPeriod: 1, durationMinutes: 25 },
  ],
  visitWindows: [
    { visitWindowId: 'morning', label: 'Morning', startTime: '09:00', endTime: '12:00' },
  ],
  items: [
    { refId: 'svc_wash', itemType: 'SERVICE', quantity: 2 },
    { refId: 'svc_wax', itemType: 'SERVICE', quantity: 1 },
    { refId: 'addon_foam', itemType: 'ADDON' },
  ],
  communities: [{ communityId: 'comm_1', status: 'active', approvalStatus: 'approved' }],
};

function request(body: unknown = command, options: { customerId?: string; key?: string | null; planId?: string } = {}): LambdaRequest {
  const key = options.key === undefined ? 'idem-1' : options.key;
  return {
    body,
    ...(options.planId ? { pathParameters: { planId: options.planId } } : {}),
    context: { authContext: { userId: options.customerId ?? 'customer-1', roles: [], permissions: [], claims: {} }, authHeader: 'Bearer token' },
    event: { headers: key ? { 'Idempotency-Key': key } : {} },
  } as unknown as LambdaRequest;
}

function planRecord(overrides: Partial<CustomerPlanRecord> = {}): CustomerPlanRecord {
  return {
    planId: 'plan-1',
    customerId: 'customer-1',
    vendorId: 'vendor_1',
    packageId: 'pkg_weekly_wash',
    offeringId: 'pkg_weekly_wash',
    vehicleId: 'veh_1',
    vehicleType: 'SEDAN',
    status: 'PENDING_PAYMENT',
    paymentStatus: 'PENDING',
    billingPeriod: 'weekly',
    cadence: 'WEEKLY',
    remainingVisits: 3,
    entitlements: [{ serviceId: 'svc_wash', quantity: 2 }, { serviceId: 'svc_wax', quantity: 1 }],
    includedServices: catalogPackage.includedServices,
    visitWindowId: 'morning',
    visitWindow: { visitWindowId: 'morning', label: 'Morning', startTime: '09:00', endTime: '12:00' },
    location: { fulfilmentType: 'community', communityId: 'comm_1' },
    pricingSnapshot: {
      totalAmount: 1999,
      totalMinor: 1999,
      currency: 'INR',
      packageId: 'pkg_weekly_wash',
      offeringId: 'pkg_weekly_wash',
      vehicleType: 'SEDAN',
      durationMinutes: 170,
    },
    autoRenew: true,
    version: 1,
    createdAt: '2026-10-28T00:00:00.000Z',
    updatedAt: '2026-10-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('CustomerPlansService', () => {
  let plans: jest.Mocked<CustomerPlansRepository>;
  let vehicles: jest.Mocked<VehicleGateway>;
  let vendors: jest.Mocked<VendorGateway>;
  let users: jest.Mocked<UserGateway>;
  let packages: jest.Mocked<CatalogPackageGateway>;
  let service: CustomerPlansService;

  beforeEach(() => {
    plans = {
      getIdempotency: jest.fn().mockResolvedValue(null),
      createPlan: jest.fn().mockImplementation(async (record: CustomerPlanRecord) => record),
      getPlan: jest.fn(),
      listCustomerPlans: jest.fn().mockResolvedValue([]),
      savePlan: jest.fn().mockImplementation(async (record: CustomerPlanRecord) => record),
    } as unknown as jest.Mocked<CustomerPlansRepository>;
    vehicles = { getVehicle: jest.fn().mockResolvedValue({ id: 'veh_1', userId: 'customer-1', vehicleType: 'SEDAN' }) };
    vendors = {
      getCheckoutEligibility: jest.fn().mockResolvedValue({
        vendor: { vendorId: 'vendor_1', vendorName: 'Beauty Wheels', status: 'ACTIVE', operationalStatus: 'ONLINE', communityIds: ['comm_1'] },
      }),
    };
    users = { getProfile: jest.fn().mockResolvedValue({ communityIds: ['comm_1'] }), assertAddress: jest.fn().mockResolvedValue(undefined) };
    packages = { getPackage: jest.fn().mockResolvedValue(catalogPackage) };
    service = new CustomerPlansService(plans, vehicles, vendors, users, packages);
  });

  describe('create', () => {
    it('creates a PENDING_PAYMENT plan with vehicle-matched price and visitWindowId without a branch', async () => {
      const result = await service.create(request());

      expect(result).toMatchObject({
        packageId: 'pkg_weekly_wash',
        offeringId: 'pkg_weekly_wash',
        vendorId: 'vendor_1',
        vehicleId: 'veh_1',
        vehicleType: 'SEDAN',
        status: 'PENDING_PAYMENT',
        billingPeriod: 'weekly',
        cadence: 'WEEKLY',
        remainingVisits: 3,
        visitWindowId: 'morning',
        location: { fulfilmentType: 'community', communityId: 'comm_1' },
        autoRenew: true,
        entitlements: [{ serviceId: 'svc_wash', quantity: 2 }, { serviceId: 'svc_wax', quantity: 1 }],
        pricingSnapshot: {
          totalAmount: 1999,
          totalMinor: 1999,
          currency: 'INR',
          packageId: 'pkg_weekly_wash',
          offeringId: 'pkg_weekly_wash',
          vehicleType: 'SEDAN',
          durationMinutes: 170,
        },
      });
      expect(result.planId).toEqual(expect.any(String));
      expect(result).not.toHaveProperty('customerId');
      expect(result).not.toHaveProperty('branchId');
      expect(result).not.toHaveProperty('billingPeriodStart');
      expect(vendors.getCheckoutEligibility).toHaveBeenCalledWith('vendor_1');
      expect(plans.createPlan).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'customer-1', autoRenew: true }),
        expect.any(String),
        'idem-1',
      );
      expect(plans.createPlan.mock.calls[0][0]).not.toHaveProperty('branchId');
      expect(packages.getPackage).toHaveBeenCalledWith(expect.objectContaining({ packageId: 'pkg_weekly_wash', vendorId: 'vendor_1' }));
    });

    it('accepts packageId as an alias of offeringId', async () => {
      const { offeringId: _offeringId, ...rest } = command;
      await expect(service.create(request({ ...rest, packageId: 'pkg_weekly_wash' }))).resolves.toMatchObject({
        offeringId: 'pkg_weekly_wash',
        packageId: 'pkg_weekly_wash',
      });
    });

    it('rejects a price mismatch without persisting a plan', async () => {
      await expect(service.create(request({ ...command, expectedPrice: { totalMinor: 1500, currency: 'INR' } })))
        .rejects.toMatchObject({ code: 'PRICE_MISMATCH', statusCode: 409 });
      expect(plans.createPlan).not.toHaveBeenCalled();
    });

    it('rejects an unsupported vehicle type', async () => {
      vehicles.getVehicle.mockResolvedValue({ id: 'veh_1', userId: 'customer-1', vehicleType: 'BIKE' });
      await expect(service.create(request())).rejects.toMatchObject({ code: 'VEHICLE_TYPE_UNSUPPORTED', statusCode: 409 });
      expect(plans.createPlan).not.toHaveBeenCalled();
    });

    it('rejects an inactive package', async () => {
      packages.getPackage.mockResolvedValue({ ...catalogPackage, active: false });
      await expect(service.create(request())).rejects.toMatchObject({ code: 'PACKAGE_INACTIVE', statusCode: 409 });
      expect(plans.createPlan).not.toHaveBeenCalled();
    });

    it('rejects an unknown visitWindowId', async () => {
      await expect(service.create(request({ ...command, visitWindowId: 'night' })))
        .rejects.toMatchObject({ code: 'VISIT_WINDOW_INVALID', statusCode: 400 });
      expect(plans.createPlan).not.toHaveBeenCalled();
    });

    it('requires Idempotency-Key and resumes matching replays', async () => {
      await expect(service.create(request(command, { key: null }))).rejects.toThrow('Idempotency-Key');
      const hash = planRequestFingerprint(validateCreateCustomerPlan(request()));
      plans.getIdempotency.mockResolvedValue({ PK: 'p', SK: 's', planId: 'plan-1', customerId: 'customer-1', requestHash: hash, entityType: 'CustomerPlanIdempotency' });
      plans.getPlan.mockResolvedValue(planRecord());
      await expect(service.create(request())).resolves.toMatchObject({ planId: 'plan-1' });
    });

    it('resumes after a concurrent create race', async () => {
      const hash = planRequestFingerprint(validateCreateCustomerPlan(request()));
      plans.createPlan.mockRejectedValueOnce(new ConditionalWriteConflictError('race'));
      plans.getIdempotency
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ PK: 'p', SK: 's', planId: 'plan-1', customerId: 'customer-1', requestHash: hash, entityType: 'CustomerPlanIdempotency' });
      plans.getPlan.mockResolvedValue(planRecord());
      await expect(service.create(request())).resolves.toMatchObject({ planId: 'plan-1' });
    });
  });

  describe('list/get', () => {
    it('lists only the authenticated customer plans', async () => {
      plans.listCustomerPlans.mockResolvedValue([planRecord(), planRecord({ planId: 'plan-x', customerId: 'customer-2' })]);
      const result = await service.list(request());
      expect(result.map((plan) => plan.planId)).toEqual(['plan-1']);
    });

    it('gets an owned plan and forbids another customer', async () => {
      plans.getPlan.mockResolvedValue(planRecord());
      await expect(service.get(request(undefined, { planId: 'plan-1' }))).resolves.toMatchObject({ planId: 'plan-1' });
      await expect(service.get(request(undefined, { planId: 'plan-1', customerId: 'customer-2' }))).rejects.toMatchObject({ statusCode: 403 });
    });

    it('returns 404 when the plan is missing', async () => {
      plans.getPlan.mockResolvedValue(null);
      await expect(service.get(request(undefined, { planId: 'nope' }))).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('markFirstJobStarted', () => {
    it('anchors billing to the first job start and activates the plan', async () => {
      plans.getPlan.mockResolvedValue(planRecord({
        status: 'AWAITING_FIRST_JOB',
        paymentStatus: 'PAID',
        firstJobId: 'job-1',
        activatedAt: '2026-10-28T01:00:00.000Z',
      }));
      const result = await service.markFirstJobStarted('plan-1', 'job-1', '2026-10-28T10:00:00.000Z');
      expect(result).toMatchObject({
        status: 'ACTIVE',
        billingPeriodStart: '2026-10-28T10:00:00.000Z',
        billingPeriodEnd: '2026-11-04T10:00:00.000Z',
        firstJobId: 'job-1',
      });
    });
  });
});
