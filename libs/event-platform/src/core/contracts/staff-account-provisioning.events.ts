import { z } from 'zod';
import { defineEvent } from '../schema/define-event';
import { registerEventDefinition } from '../../governance/event-registry';

export const STAFF_ACCOUNT_PROVISIONING_REQUESTED_EVENT_TYPE = 'Staff.AccountProvisioningRequested' as const;
export const STAFF_ACCOUNT_PROVISIONED_EVENT_TYPE = 'Staff.AccountProvisioned' as const;
export const STAFF_ACCOUNT_PROVISIONING_EVENT_VERSION = '1.0.0' as const;

export const StaffAccountProvisioningRequestedPayloadSchema = z.object({
  vendorId: z.string().min(1), staffId: z.string().min(1), phoneNumber: z.string().min(1), displayName: z.string().min(1),
}).strict();
export type StaffAccountProvisioningRequestedPayload = z.infer<typeof StaffAccountProvisioningRequestedPayloadSchema>;
export const StaffAccountProvisionedPayloadSchema = z.object({
  vendorId: z.string().min(1), staffId: z.string().min(1), identityId: z.string().min(1), userId: z.string().min(1), status: z.literal('COMPLETED'),
}).strict();
export type StaffAccountProvisionedPayload = z.infer<typeof StaffAccountProvisionedPayloadSchema>;
export const StaffAccountProvisioningRequestedEvent = defineEvent(StaffAccountProvisioningRequestedPayloadSchema, { eventType: STAFF_ACCOUNT_PROVISIONING_REQUESTED_EVENT_TYPE, eventVersion: STAFF_ACCOUNT_PROVISIONING_EVENT_VERSION, source: 'vendor-service', transport: 'eventbridge' });
export const StaffAccountProvisionedEvent = defineEvent(StaffAccountProvisionedPayloadSchema, { eventType: STAFF_ACCOUNT_PROVISIONED_EVENT_TYPE, eventVersion: STAFF_ACCOUNT_PROVISIONING_EVENT_VERSION, source: 'identity-service', transport: 'eventbridge' });
export const staffAccountProvisioningIdempotencyKey = (vendorId: string, staffId: string) => `${STAFF_ACCOUNT_PROVISIONING_REQUESTED_EVENT_TYPE}:${vendorId}:${staffId}`;
export const staffAccountProvisionedIdempotencyKey = (vendorId: string, staffId: string, identityId: string) => `${STAFF_ACCOUNT_PROVISIONED_EVENT_TYPE}:${vendorId}:${staffId}:${identityId}`;
for (const [eventType, source, ownerTeam] of [[STAFF_ACCOUNT_PROVISIONING_REQUESTED_EVENT_TYPE, 'vendor-service', 'vendor'], [STAFF_ACCOUNT_PROVISIONED_EVENT_TYPE, 'identity-service', 'identity']] as const) registerEventDefinition({ eventType, eventVersion: STAFF_ACCOUNT_PROVISIONING_EVENT_VERSION, source, transport: 'eventbridge', classification: 'domain', ownerTeam, compatibility: 'strict' });
