import {
  BOOKING_READINESS_FACT_SOURCES,
  BOOKING_READINESS_TRANSITIONS,
  BookingReadinessOutboxRepository,
  countTransitionFrom,
  publishAuthoritativeFact,
  type BookingReadinessFactPayload,
  type BookingReadinessTransition,
} from '@api-hub/event-platform';

import { env } from '../configs/env.config';
import { getServicesRepository } from '../repositories/services.repository';
import type { ServiceEntity } from '../utils/types/catalog-domain.types';
import { ensureCatalogEventPlatform } from './configure-catalog-event-platform';

export function activeBookableServiceCount(services: Array<Pick<ServiceEntity, 'active' | 'deletedAt'>>): number {
  return services.filter((service) => service.active === true && !service.deletedAt).length;
}

let outbox: BookingReadinessOutboxRepository | undefined;

function catalogOutbox(): BookingReadinessOutboxRepository {
  if (!outbox) outbox = new BookingReadinessOutboxRepository(env.DYNAMODB_TABLE_NAME, (vendorId) => `VENDOR#${vendorId}`);
  return outbox;
}

export async function listVendorServices(vendorId: string): Promise<ServiceEntity[]> {
  const services: ServiceEntity[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await getServicesRepository().listByVendor(vendorId, { limit: 100, lastEvaluatedKey: cursor });
    services.push(...page.items);
    cursor = page.lastEvaluatedKey;
  } while (cursor);
  return services;
}

/**
 * Catalog owns the bookable-service count. The changed row is overlaid because
 * the vendor service index is eventually consistent.
 */
export async function publishCatalogBookingReadiness(input: {
  vendorId: string;
  correlationId: string;
  trigger?: BookingReadinessTransition;
  changed?: { serviceId: string; active: boolean; deleted: boolean };
}): Promise<BookingReadinessFactPayload> {
  const services = await listVendorServices(input.vendorId);
  const byId = new Map(services.map((service) => [service.serviceId, service]));
  if (input.changed?.deleted) byId.delete(input.changed.serviceId);
  else if (input.changed) {
    const existing = byId.get(input.changed.serviceId);
    byId.set(input.changed.serviceId, {
      ...(existing ?? { active: input.changed.active }),
      serviceId: input.changed.serviceId,
      active: input.changed.active,
      deletedAt: undefined,
    } as ServiceEntity);
  }
  const count = activeBookableServiceCount([...byId.values()]);
  ensureCatalogEventPlatform();
  return publishAuthoritativeFact({
    outbox: catalogOutbox(),
    vendorId: input.vendorId,
    source: BOOKING_READINESS_FACT_SOURCES.CATALOG,
    correlationId: input.correlationId,
    detail: { fact: 'services', activeBookableServiceCount: count },
    transition: (current) => countTransitionFrom(current, 'services', count, input.trigger ?? BOOKING_READINESS_TRANSITIONS.UPDATED),
  });
}
