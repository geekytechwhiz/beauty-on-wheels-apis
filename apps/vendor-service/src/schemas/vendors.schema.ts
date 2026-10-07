import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

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

export const CreateVendorRequestSchema = z.object({
  businessName: z.string().min(2).max(150),
  contactName: z.string().min(2).max(100),
  phoneNumber: optionalTrimmedString(20),
  email: optionalTrimmedString(254).pipe(z.string().email().optional()),
  description: optionalTrimmedString(1000),
  gstNumber: optionalTrimmedString(50),
  panNumber: optionalTrimmedString(20),
  profileImageUrl: optionalTrimmedString(2048),
  vendorType: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
  ownerUserId: z.string().min(1).optional(),
});

export const RegisterVendorRequestSchema = z.object({ 
  email: optionalTrimmedString(254).pipe(z.string().email().optional()),
  phoneNumber: optionalTrimmedString(20), 
});

export type CreateVendorRequest =
    z.infer<typeof CreateVendorRequestSchema>;

export type RegisterVendorRequest =
    z.infer<typeof RegisterVendorRequestSchema>;

export const validateCreateVendorRequest = (req: LambdaRequest): CreateVendorRequest => {
    const body = req.body === undefined || req.body === null ? {} : req.body;
    const result = CreateVendorRequestSchema.safeParse(body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    req.body = result.data;
    return result.data;
};

export const validateRegisterVendorRequest = (
  req: LambdaRequest,
): RegisterVendorRequest => {
  const body = req.body === undefined || req.body === null ? {} : req.body;
  const result = RegisterVendorRequestSchema.safeParse(body);
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

export const UpdateVendorRequestSchema = z.object({
businessName: z.string().min(2).max(150).optional(),
contactName: z.string().max(100).optional(),
phoneNumber: z.string().optional(),
email: z.string().email().optional(),
description: z.string().max(1000).optional(),
profileImageUrl: z.string().url().optional()
}).strict();

export type UpdateVendorRequest =
    z.infer<typeof UpdateVendorRequestSchema>;

export const validateUpdateVendorRequest = (req: LambdaRequest): UpdateVendorRequest => {
    const result = UpdateVendorRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};

/**
 * ---------------------------------------------------------
 * UpdateVendorStatusRequest
 * ---------------------------------------------------------
 */

export const UpdateVendorStatusRequestSchema = z.object({
status: z.enum(["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "INACTIVE", "REJECTED"]),
reason: z.string().max(500).optional()
}).strict();

export type UpdateVendorStatusRequest =
    z.infer<typeof UpdateVendorStatusRequestSchema>;

export const validateUpdateVendorStatusRequest = (req: LambdaRequest): UpdateVendorStatusRequest => {
    const result = UpdateVendorStatusRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};

/**
 * ---------------------------------------------------------
 * UpdateOperationalStatusRequest
 * ---------------------------------------------------------
 */

export const UpdateOperationalStatusRequestSchema = z.object({
operationalStatus: z.enum(["ONLINE", "OFFLINE", "BUSY", "TEMPORARILY_UNAVAILABLE"])
}).strict();

export type UpdateOperationalStatusRequest =
    z.infer<typeof UpdateOperationalStatusRequestSchema>;

export const validateUpdateOperationalStatusRequest = (req: LambdaRequest): UpdateOperationalStatusRequest => {
    const result = UpdateOperationalStatusRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
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
