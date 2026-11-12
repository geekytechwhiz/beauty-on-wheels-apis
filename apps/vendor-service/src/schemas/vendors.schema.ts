import { z } from 'zod';
import { LambdaRequest, VEHICLE_TYPE_VALUES } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

import { SERVICE_WINDOW_IDS } from '../domain/service-windows';

/**
 * ---------------------------------------------------------
 * CreateVendorRequest
 * ---------------------------------------------------------
 */

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    });

const catalogId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);

const optionalPlaceName = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    });

export const BusinessLocationRequestSchema = z
  .object({
    addressLine1: z.string().max(200).optional(),
    addressLine2: z.string().max(200).optional(),
    landmark: z.string().max(100).optional(),
    locality: optionalPlaceName(120),
    city: z.string().max(80),
    district: z.string().max(80),
    state: z.string().max(80),
    postalCode: z
      .string()
      .trim()
      .regex(/^[1-9][0-9]{5}$/, 'postalCode must be a 6-digit PIN'),
    countryCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .transform((value) => value.toUpperCase())
      .optional(),
  })
  .strict();

export const BusinessInfoRequestSchema = z.object({
  businessName: z.string().min(2).max(150).optional(),
  contactName: z.string().min(2).max(100).optional(),
  phoneNumber: optionalTrimmedString(20),
  email: optionalTrimmedString(254).pipe(z.string().email().optional()),
  description: optionalTrimmedString(1000),
  gstNumber: optionalTrimmedString(50),
  panNumber: optionalTrimmedString(20),
  profileImageUrl: optionalTrimmedString(2048),
  businessType: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
  /**
   * Compatibility input. Normalized into location.locality and not stored separately.
   * A 400 is returned when this value conflicts with location.locality.
   */
  locality: optionalPlaceName(120),
  location: BusinessLocationRequestSchema.optional(),
}).strict();

export const CreateVendorCapabilitiesRequestSchema = z
  .object({
    vehicleTypes: z.array(z.enum(VEHICLE_TYPE_VALUES)).max(20),
    serviceIds: z.array(catalogId).max(50),
    packageIds: z.array(catalogId).max(50),
    washMethodIds: z.array(catalogId).max(50),
  })
  .strict();

const communityId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);

export const CreateVendorCommunityCoverageRequestSchema = z
  .object({
    communityIds: z.array(communityId).max(25),
  })
  .strict();

export const CreateVendorOperatingPreferencesRequestSchema = z
  .object({
    serviceWindowIds: z.array(z.enum(SERVICE_WINDOW_IDS)).max(20),
  })
  .strict();

export const CreateVendorInitialCapacityRequestSchema = z
  .object({
    activeCrewCount: z.number().int().min(0).max(1000),
    indicativeVisitsPerWeek: z.number().int().min(0).max(100000),
  })
  .strict();

export const OwnerDetailsRequestSchema = z.object({
  /** Ignored at the API boundary for staff create; login identity is not taken from the caller. */
  userId: z.string().min(1).max(100).optional(),
  fullName: z.string().min(1).max(100).optional(),
  designation: optionalTrimmedString(100),
  email: optionalTrimmedString(254).pipe(z.string().email().optional()),
  /**
   * Explicit vendor-login phone for the partner app. Never derived from
   * createdBy / staff identity. Required by createVendor for account provisioning.
   */
  phoneNumber: optionalTrimmedString(20),
}).strict();

export const CreateVendorRequestSchema = z
  .object({
    businessInfo: BusinessInfoRequestSchema.optional(),
    ownerDetails: OwnerDetailsRequestSchema.optional(),
    capabilities: CreateVendorCapabilitiesRequestSchema.optional(),
    communityCoverage: CreateVendorCommunityCoverageRequestSchema.optional(),
    operatingPreferences: CreateVendorOperatingPreferencesRequestSchema.optional(),
    initialCapacity: CreateVendorInitialCapacityRequestSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // `locality` is optional in both forms. The child schemas already trim and
    // normalize blank strings to undefined, so do not dereference an omitted value.
    const legacy = value.businessInfo?.locality;
    const nested = value.businessInfo?.location?.locality;
    if (legacy && nested && legacy.toLowerCase() !== nested.toLowerCase()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessInfo', 'location', 'locality'],
        message:
          'businessInfo.locality conflicts with businessInfo.location.locality',
      });
    }
    if ((legacy || value.businessInfo?.location) && !value.businessInfo?.location?.postalCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessInfo', 'location', 'postalCode'],
        message: 'postalCode is required when a business location or locality is provided',
      });
    }
  });

export type CreateVendorRequest = z.infer<typeof CreateVendorRequestSchema>;

export const validateCreateVendorRequest = (
  req: LambdaRequest,
): CreateVendorRequest => {
  const body = req.body === undefined || req.body === null ? {} : req.body;
  const result = CreateVendorRequestSchema.safeParse(body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};

/**
 * Partial business and contact fields stored on the vendor profile.
 * Address, owner, bank, documents, and coverage are separate sections.
 */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export const UpdateVendorRequestSchema = z
  .object({
    businessType: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
    businessName: z.string().trim().min(2).max(150).optional(),
    contactName: z.string().trim().min(2).max(100).optional(),
    phoneNumber: z.string().trim().min(8).max(20).optional(),
    email: z.string().trim().email().max(254).optional(),
    description: z.string().trim().max(1000).optional(),
    gstNumber: z.string().trim().toUpperCase().regex(GSTIN, 'gstNumber must be a GSTIN').optional(),
    panNumber: z.string().trim().toUpperCase().regex(PAN, 'panNumber must be a PAN').optional(),
    profileImageUrl: z.string().trim().url().max(2048).optional(),
    concent: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'At least one business or contact field is required',
  });

export type UpdateVendorRequest = z.infer<typeof UpdateVendorRequestSchema>;

export const validateUpdateVendorRequest = (
  req: LambdaRequest,
): UpdateVendorRequest => {
  const result = UpdateVendorRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};

/**
 * Manager confirmation of the currently saved support-prepared profile.
 * The revision must match GET /vendors/{vendorId}.revision.
 */
export const AcceptVendorDetailsRequestSchema = z
  .object({
    revision: z.number().int().min(0),
  })
  .strict();

export type AcceptVendorDetailsRequest = z.infer<
  typeof AcceptVendorDetailsRequestSchema
>;

export const validateAcceptVendorDetailsRequest = (
  req: LambdaRequest,
): AcceptVendorDetailsRequest => {
  const result = AcceptVendorDetailsRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};

/**
 * ---------------------------------------------------------
 * UpdateVendorStatusRequest
 * ---------------------------------------------------------
 */

export const UpdateVendorStatusRequestSchema = z
  .object({
    status: z.enum([
      'PENDING_VERIFICATION',
      'ACTIVE',
      'SUSPENDED',
      'INACTIVE',
      'REJECTED',
    ]),
    reason: z.string().max(500).optional(),
  })
  .strict();

export type UpdateVendorStatusRequest = z.infer<
  typeof UpdateVendorStatusRequestSchema
>;

export const validateUpdateVendorStatusRequest = (
  req: LambdaRequest,
): UpdateVendorStatusRequest => {
  const result = UpdateVendorStatusRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  return result.data;
};

/**
 * ---------------------------------------------------------
 * UpdateOperationalStatusRequest
 * ---------------------------------------------------------
 */

export const UpdateOperationalStatusRequestSchema = z
  .object({
    operationalStatus: z.enum([
      'ONLINE',
      'OFFLINE',
      'BUSY',
      'TEMPORARILY_UNAVAILABLE',
    ]),
  })
  .strict();

export type UpdateOperationalStatusRequest = z.infer<
  typeof UpdateOperationalStatusRequestSchema
>;

export const validateUpdateOperationalStatusRequest = (
  req: LambdaRequest,
): UpdateOperationalStatusRequest => {
  const result = UpdateOperationalStatusRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  return result.data;
};

export const ApproveVendorRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const RejectVendorRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const validateApproveVendorRequest = (req: LambdaRequest) => {
  const body = req.body === undefined || req.body === null ? {} : req.body;
  const result = ApproveVendorRequestSchema.safeParse(body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};

export const validateRejectVendorRequest = (req: LambdaRequest) => {
  const result = RejectVendorRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};
