import { z } from 'zod';
import { defineEvent } from '../schema/define-event';
import { registerEventDefinition } from '../../governance/event-registry';

export const VENDOR_ACCOUNT_PROVISIONING_REQUESTED_EVENT_TYPE = 'Vendor.AccountProvisioningRequested' as const;
export const VENDOR_ACCOUNT_PROVISIONED_EVENT_TYPE = 'Vendor.AccountProvisioned' as const;
export const VENDOR_ACCOUNT_PROVISIONING_EVENT_VERSION = '1.0.0' as const;
export const VENDOR_ACCOUNT_PROVISIONING_EVENT_SOURCE = 'vendor-service' as const;

export const VendorAccountProvisioningRequestedPayloadSchema = z.object({
  // Keep the supplied identifier verbatim: it is the Vendor service's
  // durable primary key, not an Identity-generated identifier.  Rejecting
  // whitespace-only values prevents an unlinked VENDOR mapping from being
  // created before any provisioning side effects begin.
  vendorId: z.string().refine((value) => value.trim().length > 0, {
    message: 'vendorId is required',
  }),
  loginPhoneNumber: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email().optional(),
}).strict();
export type VendorAccountProvisioningRequestedPayload = z.infer<typeof VendorAccountProvisioningRequestedPayloadSchema>;

export const VendorAccountProvisionedPayloadSchema = z.object({
  vendorId: z.string().min(1),
  identityId: z.string().min(1),
  userId: z.string().min(1),
  status: z.literal('COMPLETED'),
}).strict();
export type VendorAccountProvisionedPayload = z.infer<typeof VendorAccountProvisionedPayloadSchema>;

export const VendorAccountProvisioningRequestedEvent = defineEvent(VendorAccountProvisioningRequestedPayloadSchema, {
  eventType: VENDOR_ACCOUNT_PROVISIONING_REQUESTED_EVENT_TYPE, eventVersion: VENDOR_ACCOUNT_PROVISIONING_EVENT_VERSION,
  source: VENDOR_ACCOUNT_PROVISIONING_EVENT_SOURCE, transport: 'eventbridge',
});
export const VendorAccountProvisionedEvent = defineEvent(VendorAccountProvisionedPayloadSchema, {
  eventType: VENDOR_ACCOUNT_PROVISIONED_EVENT_TYPE, eventVersion: VENDOR_ACCOUNT_PROVISIONING_EVENT_VERSION,
  source: 'identity-service', transport: 'eventbridge',
});
export const vendorAccountProvisioningIdempotencyKey = (vendorId: string) => `${VENDOR_ACCOUNT_PROVISIONING_REQUESTED_EVENT_TYPE}:${vendorId}`;
export const vendorAccountProvisionedIdempotencyKey = (vendorId: string, identityId: string) => `${VENDOR_ACCOUNT_PROVISIONED_EVENT_TYPE}:${vendorId}:${identityId}`;
for (const [eventType, source, ownerTeam] of [[VENDOR_ACCOUNT_PROVISIONING_REQUESTED_EVENT_TYPE, 'vendor-service', 'vendor'], [VENDOR_ACCOUNT_PROVISIONED_EVENT_TYPE, 'identity-service', 'identity']] as const) registerEventDefinition({ eventType, eventVersion: VENDOR_ACCOUNT_PROVISIONING_EVENT_VERSION, source, transport: 'eventbridge', classification: 'domain', ownerTeam, compatibility: 'strict' });
