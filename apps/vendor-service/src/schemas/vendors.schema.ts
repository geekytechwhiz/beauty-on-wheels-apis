import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * CreateVendorRequest
 * ---------------------------------------------------------
 */

export const CreateVendorRequestSchema = z.object({
ownerUserId: z.string(),
vendorType: z.enum(["INDIVIDUAL", "BUSINESS"]),
businessName: z.string().min(2).max(150),
contactName: z.string().min(2).max(100),
phoneNumber: z.string(),
email: z.string().email().optional(),
description: z.string().max(1000).optional(),
address: z.object({
addressLine1: z.string().max(200),
addressLine2: z.string().max(200).optional(),
landmark: z.string().max(100).optional(),
city: z.string().max(100),
state: z.string().max(100),
country: z.string().max(2),
postalCode: z.string().max(20)
}),
geoLocation: z.object({
latitude: z.number().min(-90).max(90),
longitude: z.number().min(-180).max(180)
}).optional()
}).strict();

export type CreateVendorRequest =
    z.infer<typeof CreateVendorRequestSchema>;

export const validateCreateVendorRequest = (req: LambdaRequest): CreateVendorRequest => {
    const result = CreateVendorRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
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
address: z.object({
addressLine1: z.string().max(200),
addressLine2: z.string().max(200).optional(),
landmark: z.string().max(100).optional(),
city: z.string().max(100),
state: z.string().max(100),
country: z.string().max(2),
postalCode: z.string().max(20)
}).optional(),
geoLocation: z.object({
latitude: z.number().min(-90).max(90),
longitude: z.number().min(-180).max(180)
}).optional(),
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
