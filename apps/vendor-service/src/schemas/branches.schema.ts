import { z } from 'zod';
import { LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

const GeoLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

const AddressSchema = z
  .object({
    addressLine1: z.string().min(1).max(200),
    addressLine2: z.string().max(200).optional(),
    landmark: z.string().max(100).optional(),
    city: z.string().min(1).max(100),
    state: z.string().min(1).max(100),
    country: z.string().min(2).max(2),
    postalCode: z.string().min(1).max(20),
  })
  .strict();

export const CreateBranchRequestSchema = z
  .object({
    name: z.string().min(2).max(150),
    phoneNumber: z.string().max(20).optional(),
    email: z.string().email().optional(),
    address: AddressSchema.optional(),
    geoLocation: GeoLocationSchema.optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();

export const UpdateBranchRequestSchema = z
  .object({
    name: z.string().min(2).max(150).optional(),
    phoneNumber: z.string().max(20).optional(),
    email: z.string().email().optional(),
    address: AddressSchema.optional(),
    geoLocation: GeoLocationSchema.optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();

export const validateCreateBranchRequest = (req: LambdaRequest) => {
  const result = CreateBranchRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  return result.data;
};

export const validateUpdateBranchRequest = (req: LambdaRequest) => {
  const result = UpdateBranchRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  return result.data;
};
