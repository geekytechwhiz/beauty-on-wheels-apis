import { ValidationError } from '@api-hub/utils';

import {
  applyConditionalWrites,
  assertActiveDirectoryCommunities,
  buildOfferingCommunity,
  buildServiceCreatePuts,
  buildServiceIdempotency,
  communityIsIndexed,
  communityOfferingAutoApproveEnabled,
  itemKey,
  nextMappingStatus,
  nextServiceActive,
  toTransactPuts,
} from './offering-community';
import {
  OFFERING_COMMUNITY_APPROVAL,
  OFFERING_COMMUNITY_STATUS,
  ServiceEntity,
} from '../utils/types/catalog-domain.types';
import { OfferingCommunitiesService } from '../services/offering-communities.service';
import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';

function service(active = true): ServiceEntity {
  return {
    PK: 'CAT#cat-1',
    SK: 'SERVICE#svc-1',
    entityType: 'SERVICE',
    vendorId: 'vendor-1',
    categoryId: 'cat-1',
    serviceId: 'svc-1',
    name: 'Exterior Wash',
    durationMinutes: 45,
    vehicleTypes: ['SUV'],
    basePrice: 499,
    vehiclePricing: [{ vehicleType: 'SUV', price: 499, durationMinutes: 45 }],
    displayOrder: 0,
    active,
    version: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

describe('offering community records', () => {
  it('writes the service, lookup, vehicles, mappings, and idempotency in one transaction', () => {
    const created = service();
    const mapping = buildOfferingCommunity({
      service: created,
      communityId: 'community-1',
      status: OFFERING_COMMUNITY_STATUS.ACTIVE,
      approvalStatus: OFFERING_COMMUNITY_APPROVAL.APPROVED,
      now: created.createdAt,
    });
    const puts = buildServiceCreatePuts({
      service: created,
      lookup: {
        PK: 'SERVICE#svc-1',
        SK: 'META',
        entityType: 'SERVICE_LOOKUP',
        vendorId: 'vendor-1',
        categoryId: 'cat-1',
        serviceId: 'svc-1',
        active: true,
        createdAt: created.createdAt,
        updatedAt: created.createdAt,
      },
      vehicles: [{
        PK: 'CAT#cat-1',
        SK: 'VEHICLE#SUV#SERVICE#svc-1',
        entityType: 'SERVICE_VEHICLE',
        categoryId: 'cat-1',
        serviceId: 'svc-1',
        vehicleType: 'SUV',
        active: true,
        createdAt: created.createdAt,
        updatedAt: created.createdAt,
      }],
      mappings: [mapping],
      idempotency: buildServiceIdempotency({
        vendorId: 'vendor-1',
        serviceId: 'svc-1',
        categoryId: 'cat-1',
        idempotencyKey: 'create-1',
        now: created.createdAt,
      }),
    });
    const transact = toTransactPuts('catalog', puts);
    expect(transact).toHaveLength(5);
    expect(transact.every((item) => item.Put)).toBe(true);
    expect(mapping.PK).toBe('SERVICE#svc-1');
    expect(mapping.SK).toBe('COMMUNITY#community-1');
    expect(mapping.approvalStatus).toBe('approved');
    expect(mapping.GSI3PK).toBe('COMMUNITY#community-1');
    expect(mapping.GSI3SK).toBe('SERVICE#cat-1#svc-1');
    expect(communityIsIndexed(mapping)).toBe(true);
  });

  it('writes GSI3 only when the service, mapping, and approval are all eligible', () => {
    const pending = buildOfferingCommunity({
      service: service(true),
      communityId: 'community-1',
      status: OFFERING_COMMUNITY_STATUS.ACTIVE,
      approvalStatus: OFFERING_COMMUNITY_APPROVAL.PENDING,
      now: '2026-10-01T00:00:00.000Z',
    });
    const inactiveService = buildOfferingCommunity({
      service: service(false),
      communityId: 'community-1',
      status: OFFERING_COMMUNITY_STATUS.ACTIVE,
      approvalStatus: OFFERING_COMMUNITY_APPROVAL.APPROVED,
      now: '2026-10-01T00:00:00.000Z',
    });
    const paused = buildOfferingCommunity({
      service: service(true),
      communityId: 'community-1',
      status: OFFERING_COMMUNITY_STATUS.INACTIVE,
      approvalStatus: OFFERING_COMMUNITY_APPROVAL.APPROVED,
      now: '2026-10-01T00:00:00.000Z',
    });
    expect(pending.GSI3PK).toBeUndefined();
    expect(inactiveService.GSI3PK).toBeUndefined();
    expect(paused.GSI3PK).toBeUndefined();
    const resumed = nextServiceActive(inactiveService, true, '2026-10-02T00:00:00.000Z');
    expect(resumed.approvalStatus).toBe('approved');
    expect(resumed.GSI3PK).toBe('COMMUNITY#community-1');
    const pausedAgain = nextServiceActive(resumed, false, '2026-10-02T00:00:00.000Z');
    expect(pausedAgain.GSI3PK).toBeUndefined();
    expect(pausedAgain.approvalStatus).toBe('approved');
    const reactivated = nextServiceActive(pausedAgain, true, '2026-10-03T00:00:00.000Z');
    expect(reactivated.GSI3PK).toBe('COMMUNITY#community-1');
    const enabled = nextMappingStatus(paused, OFFERING_COMMUNITY_STATUS.ACTIVE, '2026-10-03T00:00:00.000Z');
    expect(enabled.approvalStatus).toBe('approved');
    expect(enabled.GSI3PK).toBe('COMMUNITY#community-1');
    const stillPending = nextMappingStatus(pending, OFFERING_COMMUNITY_STATUS.ACTIVE, '2026-10-03T00:00:00.000Z');
    expect(stillPending.approvalStatus).toBe('pending');
    expect(stillPending.GSI3PK).toBeUndefined();
  });

  it('defaults automatic approval to false unless the flag is exactly true', () => {
    const previous = process.env.COMMUNITY_OFFERING_AUTO_APPROVE;
    delete process.env.COMMUNITY_OFFERING_AUTO_APPROVE;
    expect(communityOfferingAutoApproveEnabled()).toBe(false);
    process.env.COMMUNITY_OFFERING_AUTO_APPROVE = 'TRUE';
    expect(communityOfferingAutoApproveEnabled()).toBe(false);
    process.env.COMMUNITY_OFFERING_AUTO_APPROVE = '1';
    expect(communityOfferingAutoApproveEnabled()).toBe(false);
    process.env.COMMUNITY_OFFERING_AUTO_APPROVE = 'true';
    expect(communityOfferingAutoApproveEnabled()).toBe(true);
    if (previous === undefined) {
      delete process.env.COMMUNITY_OFFERING_AUTO_APPROVE;
    } else {
      process.env.COMMUNITY_OFFERING_AUTO_APPROVE = previous;
    }
  });

  it('rejects a community that is not active in the platform directory', () => {
    expect(() => assertActiveDirectoryCommunities(['community-2'], ['community-1']))
      .toThrow(ValidationError);
  });

  it('does not create a second service for the same idempotency key', () => {
    const table = new Map<string, Record<string, unknown>>();
    const idempotency = buildServiceIdempotency({
      vendorId: 'vendor-1',
      serviceId: 'svc-1',
      categoryId: 'cat-1',
      idempotencyKey: 'create-1',
      now: '2026-10-01T00:00:00.000Z',
    });
    const first = buildServiceCreatePuts({
      service: service(),
      lookup: {
        PK: 'SERVICE#svc-1',
        SK: 'META',
        entityType: 'SERVICE_LOOKUP',
        vendorId: 'vendor-1',
        categoryId: 'cat-1',
        serviceId: 'svc-1',
        active: true,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
      vehicles: [],
      mappings: [],
      idempotency,
    });
    applyConditionalWrites(table, first);
    const duplicate = service();
    duplicate.serviceId = 'svc-2';
    duplicate.SK = 'SERVICE#svc-2';
    expect(() => applyConditionalWrites(table, buildServiceCreatePuts({
      service: duplicate,
      lookup: {
        PK: 'SERVICE#svc-2',
        SK: 'META',
        entityType: 'SERVICE_LOOKUP',
        vendorId: 'vendor-1',
        categoryId: 'cat-1',
        serviceId: 'svc-2',
        active: true,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
      vehicles: [],
      mappings: [],
      idempotency,
    }))).toThrow('ConditionalCheckFailed');
    expect(table.has(itemKey('CAT#cat-1', 'SERVICE#svc-2'))).toBe(false);
    expect(table.has(itemKey(CatalogKeyBuilder.vendorPk('vendor-1'), CatalogKeyBuilder.serviceIdempotencySk('create-1')))).toBe(true);
  });
});

describe('OfferingCommunitiesService', () => {
  function harness(covered = ['community-1', 'community-2']) {
    const table = new Map<string, Record<string, unknown>>();
    const communities = {
      async commitWrites(writes: Parameters<typeof applyConditionalWrites>[1]) {
        applyConditionalWrites(table, writes);
      },
      async getIdempotency(vendorId: string, idempotencyKey: string) {
        return table.get(itemKey(
          CatalogKeyBuilder.vendorPk(vendorId),
          CatalogKeyBuilder.serviceIdempotencySk(idempotencyKey),
        )) ?? null;
      },
      async getMapping(serviceId: string, communityId: string) {
        return table.get(itemKey(`SERVICE#${serviceId}`, `COMMUNITY#${communityId}`)) ?? null;
      },
      async listByService(serviceId: string) {
        return [...table.values()].filter((item) => item.PK === `SERVICE#${serviceId}` && item.entityType === 'OfferingCommunity');
      },
      async queryActivePage(input: { communityId: string; vendorId?: string }) {
        const items = [...table.values()].filter((item) =>
          item.GSI3PK === `COMMUNITY#${input.communityId}`
          && (!input.vendorId || item.vendorId === input.vendorId));
        return { items };
      },
    };
    const services = {
      async listByVendor() {
        return { items: [] as ServiceEntity[] };
      },
      async findByServiceId(serviceId: string) {
        return serviceId === 'svc-1' ? service() : null;
      },
    };
    const coverage = { async activeCommunityIds() { return covered; } };
    const directory = {
      async activeCommunityIds(ids: readonly string[]) {
        const allowed = new Set(covered);
        return ids.filter((id) => allowed.has(id));
      },
    };
    let clock = 0;
    const serviceLayer = new OfferingCommunitiesService(
      communities as never,
      services as never,
      directory,
      coverage,
      () => `2026-10-0${(clock += 1)}T00:00:00.000Z`,
    );
    return { table, serviceLayer, services, coverage };
  }

  it('adds a missing community and leaves an existing inactive mapping inactive', async () => {
    const { serviceLayer, table } = harness();
    const created = service();
    await serviceLayer.addCommunities(created, ['community-1']);
    const paused = nextMappingStatus(
      table.get(itemKey('SERVICE#svc-1', 'COMMUNITY#community-1')) as never,
      OFFERING_COMMUNITY_STATUS.INACTIVE,
      '2026-10-02T00:00:00.000Z',
    );
    table.set(itemKey(paused.PK, paused.SK), paused as unknown as Record<string, unknown>);
    const views = await serviceLayer.addCommunities(created, ['community-1', 'community-2']);
    expect(views.find((item) => item.communityId === 'community-1')?.status).toBe('inactive');
    expect(views.find((item) => item.communityId === 'community-1')?.approvalStatus).toBe('pending');
    expect(views.find((item) => item.communityId === 'community-2')?.status).toBe('active');
    expect(views.find((item) => item.communityId === 'community-2')?.approvalStatus).toBe('pending');
    expect(table.get(itemKey('SERVICE#svc-1', 'COMMUNITY#community-2'))).not.toHaveProperty('GSI3PK');
  });

  it('rejects a concurrent status update without changing approval', async () => {
    const { serviceLayer, table } = harness();
    const created = service();
    await serviceLayer.addCommunities(created, ['community-1']);
    const current = table.get(itemKey('SERVICE#svc-1', 'COMMUNITY#community-1')) as {
      version: number;
      approvalStatus: string;
    };
    await serviceLayer.setStatus(created, 'community-1', 'inactive', current.version);
    await expect(serviceLayer.setStatus(created, 'community-1', 'active', current.version))
      .rejects.toThrow('concurrently');
    const activated = await serviceLayer.setStatus(created, 'community-1', 'active', current.version + 1);
    expect(activated.approvalStatus).toBe('pending');
    expect(activated.status).toBe('active');
    const stored = table.get(itemKey('SERVICE#svc-1', 'COMMUNITY#community-1')) as { GSI3PK?: string };
    expect(stored.GSI3PK).toBeUndefined();
  });

  it('approves and rejects through the admin decision and keeps a rejected mapping rejected', async () => {
    const previous = process.env.COMMUNITY_OFFERING_AUTO_APPROVE;
    process.env.COMMUNITY_OFFERING_AUTO_APPROVE = 'true';
    const { serviceLayer, table } = harness();
    const created = service();
    await serviceLayer.addCommunities(created, ['community-1']);
    const key = itemKey('SERVICE#svc-1', 'COMMUNITY#community-1');
    expect((table.get(key) as { approvalStatus: string; GSI3PK?: string }).approvalStatus).toBe('approved');
    expect((table.get(key) as { GSI3PK?: string }).GSI3PK).toBe('COMMUNITY#community-1');
    const rejected = await serviceLayer.setApproval('svc-1', 'community-1', 'rejected', 1, 'admin-1');
    expect(rejected.approvalStatus).toBe('rejected');
    expect(rejected.approvalUpdatedBy).toBe('admin-1');
    expect(rejected.status).toBe('active');
    expect((table.get(key) as { GSI3PK?: string }).GSI3PK).toBeUndefined();
    await expect(serviceLayer.setApproval('svc-1', 'community-1', 'approved', 1, 'admin-1'))
      .rejects.toThrow('concurrently');
    process.env.COMMUNITY_OFFERING_AUTO_APPROVE = 'true';
    const again = await serviceLayer.addCommunities(created, ['community-1']);
    expect(again[0]?.approvalStatus).toBe('rejected');
    const approved = await serviceLayer.setApproval('svc-1', 'community-1', 'approved', rejected.version, 'admin-2');
    expect(approved.approvalStatus).toBe('approved');
    expect(approved.approvalUpdatedBy).toBe('admin-2');
    expect((table.get(key) as { GSI3PK?: string }).GSI3PK).toBe('COMMUNITY#community-1');
    if (previous === undefined) {
      delete process.env.COMMUNITY_OFFERING_AUTO_APPROVE;
    } else {
      process.env.COMMUNITY_OFFERING_AUTO_APPROVE = previous;
    }
  });

  it('drops and restores GSI3 when the service is deactivated and reactivated', async () => {
    process.env.COMMUNITY_OFFERING_AUTO_APPROVE = 'true';
    const { serviceLayer, table } = harness();
    const created = service();
    await serviceLayer.addCommunities(created, ['community-1']);
    await serviceLayer.syncServiceActive({ ...created, active: false });
    const paused = table.get(itemKey('SERVICE#svc-1', 'COMMUNITY#community-1')) as {
      approvalStatus: string;
      status: string;
      GSI3PK?: string;
    };
    expect(paused.approvalStatus).toBe('approved');
    expect(paused.status).toBe('active');
    expect(paused.GSI3PK).toBeUndefined();
    await serviceLayer.syncServiceActive(created);
    expect((table.get(itemKey('SERVICE#svc-1', 'COMMUNITY#community-1')) as { GSI3PK?: string }).GSI3PK)
      .toBe('COMMUNITY#community-1');
    delete process.env.COMMUNITY_OFFERING_AUTO_APPROVE;
  });

  it('backfill does not reset a mapping that was later paused', async () => {
    const { serviceLayer, table, services } = harness(['community-1']);
    const active = service(true);
    const inactive = service(false);
    inactive.serviceId = 'svc-paused';
    inactive.SK = 'SERVICE#svc-paused';
    inactive.PK = 'CAT#cat-1';
    services.listByVendor = async () => ({ items: [active, inactive] });
    const first = await serviceLayer.backfillVendor('vendor-1', false);
    expect(first.mappingsCreated).toBe(2);
    const pausedKey = itemKey('SERVICE#svc-1', 'COMMUNITY#community-1');
    const paused = nextMappingStatus(
      table.get(pausedKey) as never,
      OFFERING_COMMUNITY_STATUS.INACTIVE,
      '2026-10-09T00:00:00.000Z',
    );
    table.set(pausedKey, { ...paused });
    const second = await serviceLayer.backfillVendor('vendor-1', false);
    expect(second.mappingsCreated).toBe(0);
    expect(second.mappingsSkipped).toBe(2);
    expect((table.get(pausedKey) as { status: string }).status).toBe('inactive');
    const inactiveMapping = table.get(itemKey('SERVICE#svc-paused', 'COMMUNITY#community-1')) as {
      GSI3PK?: string;
      status: string;
      approvalStatus: string;
    };
    expect(inactiveMapping.status).toBe('inactive');
    expect(inactiveMapping.approvalStatus).toBe('pending');
    expect(inactiveMapping.GSI3PK).toBeUndefined();
  });

  it('does not let a later auto-approve flag rewrite an existing mapping', async () => {
    const ids = ['community-1'];
    const { serviceLayer, table, services } = harness(ids);
    services.listByVendor = async () => ({ items: [service(true)] });
    delete process.env.COMMUNITY_OFFERING_AUTO_APPROVE;
    await serviceLayer.backfillVendor('vendor-1', false);
    const key = itemKey('SERVICE#svc-1', 'COMMUNITY#community-1');
    expect((table.get(key) as { approvalStatus: string }).approvalStatus).toBe('pending');
    (table.get(key) as { approvalStatus: string }).approvalStatus = 'rejected';
    process.env.COMMUNITY_OFFERING_AUTO_APPROVE = 'true';
    ids.push('community-2');
    const second = await serviceLayer.backfillVendor('vendor-1', false);
    expect(second.mappingsCreated).toBe(1);
    expect((table.get(key) as { approvalStatus: string }).approvalStatus).toBe('rejected');
    expect((table.get(itemKey('SERVICE#svc-1', 'COMMUNITY#community-2')) as { approvalStatus: string }).approvalStatus)
      .toBe('approved');
    delete process.env.COMMUNITY_OFFERING_AUTO_APPROVE;
  });

  it('preserves a legacy mapping until an explicit pending migration', async () => {
    const { serviceLayer, table, services } = harness(['community-1']);
    services.listByVendor = async () => ({ items: [service(true)] });
    const key = itemKey('SERVICE#svc-1', 'COMMUNITY#community-1');
    table.set(key, {
      PK: 'SERVICE#svc-1',
      SK: 'COMMUNITY#community-1',
      entityType: 'OfferingCommunity',
      vendorId: 'vendor-1',
      categoryId: 'cat-1',
      serviceId: 'svc-1',
      communityId: 'community-1',
      status: 'inactive',
      serviceActive: true,
      version: 4,
      GSI3PK: 'COMMUNITY#community-1',
      GSI3SK: 'SERVICE#cat-1#svc-1',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    const preserved = await serviceLayer.backfillVendor('vendor-1', true, 'preserve');
    expect(preserved.legacyMissingApproval).toBe(1);
    expect(preserved.legacyMarkedPending).toBe(0);
    expect(preserved.mappingsCreated).toBe(0);
    expect(table.get(key)).not.toHaveProperty('approvalStatus');
    const migrated = await serviceLayer.backfillVendor('vendor-1', false, 'pending');
    expect(migrated.legacyMarkedPending).toBe(1);
    const stored = table.get(key) as { approvalStatus: string; status: string; version: number; GSI3PK?: string };
    expect(stored.approvalStatus).toBe('pending');
    expect(stored.status).toBe('inactive');
    expect(stored.version).toBe(4);
    expect(stored.GSI3PK).toBeUndefined();
    const again = await serviceLayer.backfillVendor('vendor-1', false, 'pending');
    expect(again.legacyMarkedPending).toBe(0);
    expect((table.get(key) as { version: number }).version).toBe(4);
  });

  it('creates every selected community in one transaction and replays the idempotency key', async () => {
    const { serviceLayer } = harness();
    const created = service();
    const prepared = await serviceLayer.prepareCreate({
      service: created,
      communityIds: ['community-1', 'community-2'],
      idempotencyKey: 'create-1',
    });
    const mappings = prepared.puts.filter((put) => put.item.entityType === 'OfferingCommunity');
    expect(mappings).toHaveLength(2);
    expect(prepared.puts).toHaveLength(6);
    expect(mappings.every((put) => put.item.approvalStatus === 'pending' && put.condition === 'absent')).toBe(true);
    await serviceLayer.commitCreate(prepared.puts);
    const replay = await serviceLayer.prepareCreate({
      service: { ...created, serviceId: 'svc-other' },
      communityIds: ['community-1'],
      idempotencyKey: 'create-1',
    });
    expect(replay.replay).toEqual({ serviceId: 'svc-1', categoryId: 'cat-1' });
    expect(replay.puts).toHaveLength(0);
  });
});
