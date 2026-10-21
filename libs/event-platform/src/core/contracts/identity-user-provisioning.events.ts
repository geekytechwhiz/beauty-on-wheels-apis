import { z } from 'zod';

import { defineEvent } from '../schema/define-event';
import { registerEventDefinition } from '../../governance/event-registry';

export const IDENTITY_REGISTERED_EVENT_TYPE = 'Identity.Registered' as const;
export const USER_PROVISIONED_EVENT_TYPE = 'User.Provisioned' as const;
export const IDENTITY_USER_PROVISIONING_EVENT_VERSION = '1.0.0' as const;

export const IdentityRegisteredPayloadSchema = z.object({
  identityId: z.string().min(1),
  /** Stable application subject id already used by existing auth/authorizer contracts. */
  userId: z.string().min(1),
  phone: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phoneVerified: z.boolean(),
  emailVerified: z.boolean().optional(),
}).strict();

export type IdentityRegisteredPayload = z.infer<typeof IdentityRegisteredPayloadSchema>;

export const IdentityRegisteredEvent = defineEvent(IdentityRegisteredPayloadSchema, {
  eventType: IDENTITY_REGISTERED_EVENT_TYPE,
  eventVersion: IDENTITY_USER_PROVISIONING_EVENT_VERSION,
  source: 'identity-service',
  transport: 'eventbridge',
});

export const UserProvisionedPayloadSchema = z.object({
  identityId: z.string().min(1),
  userId: z.string().min(1),
  created: z.boolean(),
}).strict();

export type UserProvisionedPayload = z.infer<typeof UserProvisionedPayloadSchema>;

export const UserProvisionedEvent = defineEvent(UserProvisionedPayloadSchema, {
  eventType: USER_PROVISIONED_EVENT_TYPE,
  eventVersion: IDENTITY_USER_PROVISIONING_EVENT_VERSION,
  source: 'user-service',
  transport: 'eventbridge',
});

export function identityRegisteredIdempotencyKey(identityId: string): string {
  return `${IDENTITY_REGISTERED_EVENT_TYPE}:${identityId}`;
}

export function userProvisionedIdempotencyKey(identityId: string, userId: string): string {
  return `${USER_PROVISIONED_EVENT_TYPE}:${identityId}:${userId}`;
}

for (const [eventType, source] of [
  [IDENTITY_REGISTERED_EVENT_TYPE, 'identity-service'],
  [USER_PROVISIONED_EVENT_TYPE, 'user-service'],
] as const) {
  registerEventDefinition({
    eventType,
    eventVersion: IDENTITY_USER_PROVISIONING_EVENT_VERSION,
    source,
    transport: 'eventbridge',
    classification: 'domain',
    ownerTeam: eventType.startsWith('Identity') ? 'identity' : 'user',
    compatibility: 'strict',
  });
}
