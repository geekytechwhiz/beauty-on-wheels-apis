import { z } from 'zod';

export const createOrganizationSchema = z.object({
  organizationId: z.string().optional(),
  name: z.string().min(1).max(255),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional().default('ACTIVE'),
  organizationType: z.string().optional(),
  website: z.string().optional(),
  taxId: z.string().optional(),
  registrationNumber: z.string().optional(),
  description: z.string().optional(),
  industry: z.string().optional(),
  size: z.enum(['SMALL', 'MEDIUM', 'LARGE']).optional(),
});

export const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  organizationType: z.string().optional(),
  website: z.string().optional(),
  taxId: z.string().optional(),
  registrationNumber: z.string().optional(),
  description: z.string().optional(),
  industry: z.string().optional(),
  size: z.enum(['SMALL', 'MEDIUM', 'LARGE']).optional(),
});

export const updateOrganizationMetadataSchema = z.object({
  metadata: z.record(z.string(), z.unknown()).refine((obj) => Object.keys(obj).length > 0, {
    message: 'Metadata must be a non-empty object',
  }),
  updatedBy: z.string().optional(),
  version: z.number().int().nonnegative().optional(),
});
