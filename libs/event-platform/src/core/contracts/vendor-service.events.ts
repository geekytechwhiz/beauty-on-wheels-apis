import { z } from 'zod';

import { defineEvent } from '../schema/define-event';
import { registerEventDefinition } from '../../governance/event-registry';

/** A deliberately small catalog fact: it is sufficient for readiness, not a catalog replica. */
export const VENDOR_SERVICE_EVENT_VERSION = '1.0.0' as const;
export const VENDOR_SERVICE_EVENT_SOURCE = 'service-catalog-service' as const;
export const VENDOR_SERVICE_EVENT_TYPES = {
  CHANGED: 'VendorService.Changed',
} as const;

export const VendorServiceSnapshotSchema = z.object({
  vendorId: z.string().min(1),
  serviceId: z.string().min(1),
  version: z.number().int().nonnegative(),
  active: z.boolean(),
  deleted: z.boolean(),
  occurredAt: z.string().min(1),
}).strict();
export type VendorServiceSnapshot = z.infer<typeof VendorServiceSnapshotSchema>;

export const VendorServiceChangedEvent = defineEvent(VendorServiceSnapshotSchema, {
  eventType: VENDOR_SERVICE_EVENT_TYPES.CHANGED,
  eventVersion: VENDOR_SERVICE_EVENT_VERSION,
  source: VENDOR_SERVICE_EVENT_SOURCE,
  transport: 'eventbridge',
});

registerEventDefinition({
  eventType: VENDOR_SERVICE_EVENT_TYPES.CHANGED,
  eventVersion: VENDOR_SERVICE_EVENT_VERSION,
  source: VENDOR_SERVICE_EVENT_SOURCE,
  transport: 'eventbridge',
  classification: 'domain',
  ownerTeam: 'service-catalog',
  compatibility: 'strict',
});

export function vendorServiceIdempotencyKey(serviceId: string, version: number, deleted: boolean): string {
  return `VendorService:${serviceId}:${version}:${deleted ? 'deleted' : 'changed'}`;
}
