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
  branchId: 'branch_1',
  packageId: 'pkg_weekly_wash',
  vehicleId: 'veh_1',
  location: { fulfilmentType: 'community', communityId: 'comm_1', addressId: 'addr_1' },
  cadence: 'WEEKLY',
  visitWindow: { preferredDays: ['MON', 'THU'], startTime: '09:00', endTime: '12:00', timezone: 'Asia/Kolkata' },
  expectedPrice: { totalMinor: 1999, currency: 'INR' },
};

const catalogPackage: CatalogPackage = {
  id: 'pkg_weekly_wash',
  vendorId: 'vendor_1',
  name: 'Weekly Wash',
  active: true,
  discountedPrice: 1999,
  currency: 'INR',
  version: 3,
  items: [
    { refId: 'svc_wash', itemType: 'SERVICE' },
    { refId: 'svc_wash', itemType: 'SERVICE' },
    { refId: 'svc_wax', itemType: 'SERVICE' },
    { refId: 'addon_foam', itemType: 'ADDON' },
  ],
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
    planId: 'plan-1', customerId: 'customer-1', vendorId: 'vendor_1', branchId: 'branch_1', packageId: 'pkg_weekly_wash',
    vehicleId: 'veh_1', status: 'PENDING_PAYMENT', paymentStatus: 'PENDING', cadence: 'WEEKLY', remainingVisits: 3,
    entitlements: [{ serviceId: 'svc_wash', quantity: 2 }, { serviceId: 'svc_wax', quantity: 1 }],
    visitWindow: command.visitWindow as CustomerPlanRecord['visitWindow'], location: { fulfilmentType: 'community', communityId: 'comm_1' },
    pricingSnapshot: { totalAmount: 1999, totalMinor: 1999, currency: 'INR', packageId: 'pkg_weekly_wash' },
    version: 1, createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z',
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
    } as unknown as jest.Mocked<CustomerPlansRepository>;
    vehicles = { getVehicle: jest.fn().mockResolvedValue({ id: 'veh_1', userId: 'customer-1', vehicleType: 'SEDAN' }) };
    vendors = {
      getCheckoutEligibility: jest.fn().mockResolvedValue({
        vendor: { vendorId: 'vendor_1', vendorName: 'Beauty Wheels', status: 'ACTIVE', operationalStatus: 'ONLINE', communityIds: ['comm_1'] },
        branch: { branchId: 'branch_1', vendorId: 'vendor_1', branchName: 'Indiranagar' },
      }),
    };
    users = { getProfile: jest.fn().mockResolvedValue({ communityIds: ['comm_1'] }), assertAddress: jest.fn().mockResolvedValue(undefined) };
    packages = { getPackage: jest.fn().mockResolvedValue(catalogPackage) };
    service = new CustomerPlansService(plans, vehicles, vendors, users, packages);
  });

  describe('create', () => {
    it('creates a PENDING_PAYMENT plan with entitlements derived from package items', async () => {
      const result = await service.create(request());

      expect(result).toMatchObject({
        packageId: 'pkg_weekly_wash', vendorId: 'vendor_1', vehicleId: 'veh_1', status: 'PENDING_PAYMENT', cadence: 'WEEKLY',
        remainingVisits: 3,
        entitlements: [{ serviceId: 'svc_wash', quantity: 2 }, { serviceId: 'svc_wax', quantity: 1 }],
        visitWindow: command.visitWindow,
        pricingSnapshot: { totalAmount: 1999, totalMinor: 1999, currency: 'INR', packageId: 'pkg_weekly_wash' },
      });
      expect(result.planId).toEqual(expect.any(String));
      expect(result).not.toHaveProperty('customerId');
      expect(plans.createPlan).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'customer-1' }), expect.any(String), 'idem-1');
      expect(packages.getPackage).toHaveBeenCalledWith(expect.objectContaining({ packageId: 'pkg_weekly_wash', vendorId: 'vendor_1' }));
    });

    it('rejects a price mismatch without persisting a plan', async () => {
      await expect(service.create(request({ ...command, expectedPrice: { totalMinor: 1500, currency: 'INR' } })))
        .rejects.toMatchObject({ code: 'PRICE_MISMATCH', statusCode: 409 });
      expect(plans.createPlan).not.toHaveBeenCalled();
    });

    it('rejects a currency mismatch', async () => {
      await expect(service.create(request({ ...command, expectedPrice: { totalMinor: 1999, currency: 'USD' } })))
        .rejects.toMatchObject({ code: 'PRICE_MISMATCH' });
    });

    it('rejects an inactive package', async () => {
      packages.getPackage.mockResolvedValue({ ...catalogPackage, active: false });
      await expect(service.create(request())).rejects.toMatchObject({ code: 'PACKAGE_INACTIVE', statusCode: 409 });
      expect(plans.createPlan).not.toHaveBeenCalled();
    });

    it('rejects a package that belongs to a different vendor', async () => {
      packages.getPackage.mockResolvedValue({ ...catalogPackage, vendorId: 'vendor_9' });
      await expect(service.create(request())).rejects.toMatchObject({ code: 'PACKAGE_NOT_FOUND', statusCode: 404 });
    });

    it('rejects a vehicle the customer does not own', async () => {
      vehicles.getVehicle.mockResolvedValue({ id: 'veh_1', userId: 'someone-else', vehicleType: 'SEDAN' });
      await expect(service.create(request())).rejects.toMatchObject({ code: 'VEHICLE_NOT_OWNED', statusCode: 403 });
      expect(plans.createPlan).not.toHaveBeenCalled();
    });

    it('rejects an ineligible vendor', async () => {
      vendors.getCheckoutEligibility.mockResolvedValue({
        vendor: { vendorId: 'vendor_1', status: 'ACTIVE', operationalStatus: 'OFFLINE', communityIds: [] },
        branch: { branchId: 'branch_1', vendorId: 'vendor_1' },
      });
      await expect(service.create(request())).rejects.toMatchObject({ code: 'VENDOR_NOT_ELIGIBLE' });
    });

    it('requires an Idempotency-Key and rejects unknown or invalid fields', async () => {
      await expect(service.create(request(command, { key: null }))).rejects.toThrow('Idempotency-Key');
      await expect(service.create(request({ ...command, totalAmount: 1 }))).rejects.toThrow();
      await expect(service.create(request({ ...command, cadence: 'DAILY' }))).rejects.toThrow();
      await expect(service.create(request({ ...command, visitWindow: { ...command.visitWindow, endTime: '08:00' } }))).rejects.toThrow();
      expect(plans.createPlan).not.toHaveBeenCalled();
    });

    it('replays the stored plan for the same key and request, and conflicts for a different request', async () => {
      const hash = planRequestFingerprint(validateCreateCustomerPlan(request()));
      plans.getIdempotency.mockResolvedValue({ PK: 'p', SK: 's', planId: 'plan-1', customerId: 'customer-1', requestHash: hash, entityType: 'CustomerPlanIdempotency' });
      plans.getPlan.mockResolvedValue(planRecord());

      await expect(service.create(request())).resolves.toMatchObject({ planId: 'plan-1' });
      expect(plans.createPlan).not.toHaveBeenCalled();

      await expect(service.create(request({ ...command, cadence: 'MONTHLY' }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 });
    });

    it('resolves a concurrent create through the idempotency record', async () => {
      const hash = planRequestFingerprint(validateCreateCustomerPlan(request()));
      plans.createPlan.mockRejectedValue(new ConditionalWriteConflictError(new Error('conflict')));
      plans.getIdempotency
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ PK: 'p', SK: 's', planId: 'plan-1', customerId: 'customer-1', requestHash: hash, entityType: 'CustomerPlanIdempotency' });
      plans.getPlan.mockResolvedValue(planRecord());
      await expect(service.create(request())).resolves.toMatchObject({ planId: 'plan-1' });
    });
  });

  describe('list and get ownership', () => {
    it('lists plans scoped to the authenticated customer and never emits another owner row', async () => {
      plans.listCustomerPlans.mockResolvedValue([planRecord(), planRecord({ planId: 'plan-x', customerId: 'customer-2' })]);

      const result = await service.list(request(undefined, { customerId: 'customer-1' }));

      expect(plans.listCustomerPlans).toHaveBeenCalledWith('customer-1');
      expect(result.map((plan) => plan.planId)).toEqual(['plan-1']);
      expect(result[0]).not.toHaveProperty('customerId');
    });

    it('returns plan detail to the owner only', async () => {
      plans.getPlan.mockResolvedValue(planRecord());
      await expect(service.get(request(undefined, { planId: 'plan-1' }))).resolves.toMatchObject({ planId: 'plan-1' });
      await expect(service.get(request(undefined, { planId: 'plan-1', customerId: 'customer-2' }))).rejects.toMatchObject({ statusCode: 403 });
    });

    it('returns 404 for an unknown plan', async () => {
      plans.getPlan.mockResolvedValue(null);
      await expect(service.get(request(undefined, { planId: 'nope' }))).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
