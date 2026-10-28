import { z } from 'zod';

import { defineEvent } from '../schema/define-event';
import { registerEventDefinition } from '../../governance/event-registry';

export const VENDOR_DISCOVERY_CHANGED_EVENT_TYPE = 'VendorDiscoveryChanged' as const;
export const VENDOR_DISCOVERY_CHANGED_EVENT_VERSION = '1.0.0' as const;
export const VENDOR_DISCOVERY_CHANGED_EVENT_SOURCE = 'vendor-service' as const;

export const VENDOR_DISCOVERY_CHANGED_EVENT_OPERATIONS = {
  STREAM_PUBLISH: 'vendor.discovery.changed.processed',
  CATALOG_CONSUME: 'catalog.discovery.facts.processed',
} as const;

export const VENDOR_DISCOVERY_SUBJECTS = [
  'branch',
  'coverage',
  'pricing',
  'operations',
  'community',
] as const;

export type VendorDiscoverySubject = (typeof VENDOR_DISCOVERY_SUBJECTS)[number];

export const VendorDiscoveryChangedPayloadSchema = z.object({
  vendorId: z.string().min(1),
  updatedAt: z.string().min(1),
  subject: z.enum(VENDOR_DISCOVERY_SUBJECTS),
  communityId: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
  if (value.subject === 'community' && !value.communityId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['communityId'],
      message: 'communityId is required when subject is community',
    });
  }
});

export type VendorDiscoveryChangedPayload = z.infer<typeof VendorDiscoveryChangedPayloadSchema>;

export const VendorDiscoveryChangedEvent = defineEvent(VendorDiscoveryChangedPayloadSchema, {
  eventType: VENDOR_DISCOVERY_CHANGED_EVENT_TYPE,
  eventVersion: VENDOR_DISCOVERY_CHANGED_EVENT_VERSION,
  source: VENDOR_DISCOVERY_CHANGED_EVENT_SOURCE,
  transport: 'eventbridge',
});

export function vendorDiscoveryChangedIdempotencyKey(eventId: string): string {
  return `${VENDOR_DISCOVERY_CHANGED_EVENT_TYPE}:${eventId}`;
}

registerEventDefinition({
  eventType: VENDOR_DISCOVERY_CHANGED_EVENT_TYPE,
  eventVersion: VENDOR_DISCOVERY_CHANGED_EVENT_VERSION,
  source: VENDOR_DISCOVERY_CHANGED_EVENT_SOURCE,
  transport: 'eventbridge',
  classification: 'domain',
  ownerTeam: 'vendor',
  compatibility: 'strict',
});
