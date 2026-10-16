import { z } from 'zod';
import { LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

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

export const BusinessInfoRequestSchema = z.object({
  businessName: z.string().min(2).max(150),
  contactName: z.string().min(2).max(100),
  phoneNumber: optionalTrimmedString(20),
  email: optionalTrimmedString(254).pipe(z.string().email().optional()),
  description: optionalTrimmedString(1000),
  gstNumber: optionalTrimmedString(50),
  panNumber: optionalTrimmedString(20),
  profileImageUrl: optionalTrimmedString(2048),
  businessType: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
});

export const OwnerDetailsRequestSchema = z.object({
  userId: z.string().min(1).max(100),
  fullName: z.string().min(1).max(100),
  designation: optionalTrimmedString(100),
  email: optionalTrimmedString(254).pipe(z.string().email().optional()),
  phoneNumber: optionalTrimmedString(20),
});

export const CreateVendorRequestSchema = z.object({
  businessInfo: BusinessInfoRequestSchema,
  ownerDetails: OwnerDetailsRequestSchema,
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
 * ---------------------------------------------------------
 * UpdateVendorRequest
 * ---------------------------------------------------------
 */

export const UpdateVendorRequestSchema = z
  .object({
    businessName: z.string().min(2).max(150).optional(),
    contactName: z.string().max(100).optional(),
    phoneNumber: z.string().optional(),
    email: z.string().email().optional(),
    description: z.string().max(1000).optional(),
    profileImageUrl: z.string().url().optional(),
  })
  .strict();

export type UpdateVendorRequest = z.infer<typeof UpdateVendorRequestSchema>;

export const validateUpdateVendorRequest = (
  req: LambdaRequest,
): UpdateVendorRequest => {
  const result = UpdateVendorRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
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

export type UpdateVendorOnboardingRequest = z.infer<
  typeof UpdateVendorOnboardingRequestSchema
>;

export const AddressDataSchema = z
  .object({
    addressLine1: z.string().trim().min(1).max(200),
    addressLine2: z.string().trim().max(200).optional(),
    landmark: z.string().trim().max(100).optional(),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().min(1).max(100),
    country: z.string().trim().length(2),
    postalCode: z.string().trim().min(1).max(20),
  })
  .strict();

export const BranchDataSchema = z
  .object({
    branchId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(2).max(150).optional(),
    phoneNumber: z.string().trim().min(1).max(20).optional(),
    email: z.string().email().optional(),
    address: AddressDataSchema.optional(),
    geoLocation: z
      .object({
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const BankDetailsDataSchema = z
  .object({
    accountHolderName: z.string().trim().min(2).max(150),
    accountNumber: z.string().regex(/^\d{8,18}$/, {
      message: 'Account number must contain 8–18 digits',
    }),
    ifscCode: z
      .string()
      .trim()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, {
        message: 'Invalid IFSC code',
      }),
    bankName: z.string().trim().min(2).max(150).optional(),
    branchName: z.string().trim().max(150).optional(),
    accountType: z.enum(['SAVINGS', 'CURRENT']).optional(),
  })
  .strict();

export type BankDetailsData = z.infer<typeof BankDetailsDataSchema>;

export const DocumentsDataSchema = z
  .object({
    documentType: z.enum([
      'GST_REGISTRATION',
      'BUSINESS_REGISTRATION',
      'COMMERCIAL_INSURANCE',
    ]),
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine(
        (value) =>
          !value.includes('/') &&
          !value.includes('\\') &&
          !value.includes('..'),
        { message: 'File name must not contain a path' },
      ),
    contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    fileSize: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
  })
  .strict();

export type DocumentsData = z.infer<typeof DocumentsDataSchema>;

export const UpdateVendorOnboardingRequestSchema = z.discriminatedUnion(
  'section',
  [
    z
      .object({
        section: z.literal('BUSINESS_INFO_AND_OWNER'),
        data: z
          .object({
            businessInfo: CreateVendorRequestSchema,
            ownerDetails: OwnerDetailsRequestSchema,
          })
          .strict(),
      })
      .strict(),

    z
      .object({
        section: z.literal('SERVICE_LOCATION_AND_COVERAGE'),
        data: z
          .object({
            address: AddressDataSchema,
            branch: BranchDataSchema,
          })
          .strict(),
      })
      .strict(),

    z
      .object({
        section: z.literal('BUSINESS_VERIFICATION'),
        data: DocumentsDataSchema,
      })
      .strict(),

    z
      .object({
        section: z.literal('BANK_AND_PAYOUT_DETAILS'),
        data: BankDetailsDataSchema,
      })
      .strict(),
  ],
);