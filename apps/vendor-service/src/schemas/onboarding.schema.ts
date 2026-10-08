import { z } from 'zod';
import { LambdaRequest, ValidationError } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

import { BadRequestError } from '../errors';
import { env } from '../configs/env.config';
import {
  DOCUMENT_TYPE,
  ONBOARDING_SECTION,
  isOnboardingSection,
} from '../domain/onboarding';

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

export const BusinessInfoDataSchema = z
  .object({
    vendorType: z.enum(['INDIVIDUAL', 'BUSINESS']),
    businessName: z.string().min(2).max(150),
    contactName: z.string().min(2).max(100),
    phoneNumber: z.string().min(5).max(20),
    email: z.string().email().optional(),
    description: z.string().max(1000).optional(),
    gstNumber: z.string().max(20).optional(),
    panNumber: z.string().max(20).optional(),
    profileImageUrl: z.string().url().optional(),
  })
  .strict();

export const OwnerDetailsDataSchema = z
  .object({
    userId: z.string().min(1),
    fullName: z.string().min(2).max(100),
    designation: z.string().max(100).optional(),
    phoneNumber: z.string().max(20).optional(),
    email: z.string().email().optional(),
  })
  .strict();

export const AddressDataSchema = AddressSchema.extend({
  geoLocation: GeoLocationSchema.optional(),
}).strict();

export const BranchDataSchema = z
  .object({
    branchId: z.string().min(1).optional(),
    name: z.string().min(2).max(150),
    phoneNumber: z.string().max(20).optional(),
    email: z.string().email().optional(),
    address: AddressSchema.optional(),
    geoLocation: GeoLocationSchema.optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();

export const DocumentsDataSchema = z
  .object({
    documentType: z.enum([
      DOCUMENT_TYPE.GST_REGISTRATION,
      DOCUMENT_TYPE.BUSINESS_REGISTRATION,
      DOCUMENT_TYPE.COMMERCIAL_INSURANCE,
    ]),
    fileName: z.string().min(1).max(255),
    contentType: z.enum(
      env.DOCUMENT_ALLOWED_CONTENT_TYPES as [string, ...string[]],
    ),
    fileSize: z.number().int().positive().max(env.DOCUMENT_MAX_FILE_SIZE),
  })
  .strict();

export const BankDetailsDataSchema = z
  .object({
    accountHolderName: z.string().min(2).max(150),
    accountNumber: z.string().min(8).max(18).regex(/^\d+$/),
    ifscCode: z
      .string()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code'),
    bankName: z.string().min(2).max(150),
    branchName: z.string().max(150).optional(),
    accountType: z.enum(['SAVINGS', 'CURRENT']).optional(),
  })
  .strict();

const SECTION_DATA_SCHEMAS = {
  [ONBOARDING_SECTION.BUSINESS_INFO]: BusinessInfoDataSchema,
  [ONBOARDING_SECTION.OWNER_DETAILS]: OwnerDetailsDataSchema,
  [ONBOARDING_SECTION.ADDRESS]: AddressDataSchema,
  [ONBOARDING_SECTION.BRANCH]: BranchDataSchema,
  [ONBOARDING_SECTION.DOCUMENTS]: DocumentsDataSchema,
  [ONBOARDING_SECTION.BANK_DETAILS]: BankDetailsDataSchema,
} as const;

export function validateUpdateOnboardingRequest(req: LambdaRequest) {
  const body = req.body as { section?: unknown; data?: unknown } | undefined;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('Request body is required');
  }

  if (!isOnboardingSection(body.section)) {
    throw new BadRequestError(
      `Invalid section. Supported values: ${Object.values(ONBOARDING_SECTION).join(', ')}`,
      [{ field: 'section', message: 'Unknown onboarding section' }],
    );
  }

  if (body.data === undefined || body.data === null) {
    throw new ValidationError('data is required', [
      { field: 'data', message: 'Section payload is required' },
    ]);
  }

  const result = SECTION_DATA_SCHEMAS[body.section].safeParse(body.data);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }

  req.body = {
    section: body.section,
    data: result.data,
  };

  return req.body;
}
