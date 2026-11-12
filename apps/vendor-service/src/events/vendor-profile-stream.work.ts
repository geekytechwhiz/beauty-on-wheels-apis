import { z } from 'zod';
import {
  defineEvent,
  VendorEmailVerificationRequestedPayloadSchema,
} from '@api-hub/event-platform';

export const VENDOR_PROFILE_STREAM_WORK_EVENT_TYPE =
  'Vendor.ProfileStreamWork' as const;
export const VENDOR_PROFILE_STREAM_WORK_EVENT_VERSION = '1.0.0' as const;

export const VendorProfileStreamWorkPayloadSchema = z
  .object({
    vendorId: z.string().min(1),
    streamEventName: z.enum(['INSERT', 'MODIFY']),
    needsAccountProvisioning: z.boolean(),
    needsEmailVerification: z.boolean(),
    provisioning: z
      .object({
        loginPhoneNumber: z.string().min(1),
        displayName: z.string().min(1),
        email: z.string().email().optional(),
      })
      .optional(),
    emailVerification: VendorEmailVerificationRequestedPayloadSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.needsAccountProvisioning || value.needsEmailVerification,
    { message: 'at least one stream work item is required' },
  );

export type VendorProfileStreamWorkPayload = z.infer<
  typeof VendorProfileStreamWorkPayloadSchema
>;

/** Internal stream-routing schema; never published to EventBridge. */
export const VendorProfileStreamWorkEvent = defineEvent(
  VendorProfileStreamWorkPayloadSchema,
  {
    eventType: VENDOR_PROFILE_STREAM_WORK_EVENT_TYPE,
    eventVersion: VENDOR_PROFILE_STREAM_WORK_EVENT_VERSION,
    source: 'vendor-service',
    transport: 'eventbridge',
  },
);
