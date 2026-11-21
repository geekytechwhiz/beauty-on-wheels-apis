import { z } from 'zod';
import { EventSchemaError } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { COMMUNITY_STATUS } from '../domain/constants';
import {
  CommunityAccessType,
  CommunityCreate,
  CommunityLeadSource,
  CommunityUpdate,
  CustomerCommunitiesUpdate,
} from '../types/api-types';

const communityCode = z
  .string()
  .trim()
   

const locationId = z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,149}$/);
const postalCode = z.string().trim().regex(/^[1-9][0-9]{5}$/);
const indianMobile = z.string().trim().regex(/^(?:\+91)?[6-9][0-9]{9}$/);
const email = z.string().trim().email().max(254);
const positiveInteger = z.number().int().positive().max(10_000_000);
const nonNegativeInteger = z.number().int().nonnegative().max(10_000_000);

// These values are deliberately kept as the UI select values, not translated labels.
const COMMUNITY_ACCESS_TYPES = [
  'APARTMENT_COMPLEX',
  'GATED_COMMUNITY',
  'VILLA_COMMUNITY',
  'INDEPENDENT_HOUSES',
  'MIXED_RESIDENTIAL',
] as const satisfies readonly CommunityAccessType[];
const COMMUNITY_LEAD_SOURCES = [
  'FIELD_SCOUTING',
  'REFERRAL',
  'ASSOCIATION_OUTREACH',
  'INBOUND_ENQUIRY',
  'OTHER',
] as const satisfies readonly CommunityLeadSource[];

const communityFields = {
  name: z.string().trim().min(1).max(120),
  code: communityCode,
  accessType: z.enum(COMMUNITY_ACCESS_TYPES),
  city: z.string().trim().min(1).max(80),
  cityId: locationId,
  locality: z.string().trim().min(1).max(120),
  localityId: locationId,
  postalCode,
  streetAddress: z.string().trim().min(1).max(300),
  contactPersonName: z.string().trim().min(1).max(120),
  contactPersonTitle: z.string().trim().min(1).max(100),
  contactPhone: indianMobile,
  contactEmail: email,
  totalResidentialUnits: positiveInteger,
  estimatedVehicleCount: nonNegativeInteger,
  leadSource: z.enum(COMMUNITY_LEAD_SOURCES),
  intakeNotes: z.string().trim().min(1).max(2000),
};

export const CommunityCreateSchema = z
  .object({
    ...communityFields,
    code: communityFields.code.optional(),
    cityId: communityFields.cityId.optional(),
    localityId: communityFields.localityId.optional(),
    streetAddress: communityFields.streetAddress.optional(),
    contactEmail: communityFields.contactEmail.optional(),
    intakeNotes: communityFields.intakeNotes.optional(),
  })
  .strict();

export const CommunityUpdateSchema = z
  .object({
    name: communityFields.name.optional(),
    code: communityFields.code.optional(),
    accessType: communityFields.accessType.optional(),
    city: communityFields.city.optional(),
    cityId: communityFields.cityId.optional(),
    locality: communityFields.locality.optional(),
    localityId: communityFields.localityId.optional(),
    postalCode: communityFields.postalCode.optional(),
    streetAddress: communityFields.streetAddress.optional(),
    contactPersonName: communityFields.contactPersonName.optional(),
    contactPersonTitle: communityFields.contactPersonTitle.optional(),
    contactPhone: communityFields.contactPhone.optional(),
    contactEmail: communityFields.contactEmail.optional(),
    totalResidentialUnits: communityFields.totalResidentialUnits.optional(),
    estimatedVehicleCount: communityFields.estimatedVehicleCount.optional(),
    leadSource: communityFields.leadSource.optional(),
    intakeNotes: communityFields.intakeNotes.optional(),
    status: z.enum([COMMUNITY_STATUS.ACTIVE, COMMUNITY_STATUS.INACTIVE]).optional(),
  })
  .strict();

export const CustomerCommunitiesUpdateSchema = z
  .object({
    communityIds: z.array(z.string().trim().min(1).max(80)).max(20),
  })
  .strict();

export const validateCommunityCreate = (req: LambdaRequest): CommunityCreate => {
  const result = CommunityCreateSchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};

export const validateCommunityUpdate = (req: LambdaRequest): CommunityUpdate => {
  const result = CommunityUpdateSchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};

export const validateCustomerCommunitiesUpdate = (
  req: LambdaRequest,
): CustomerCommunitiesUpdate => {
  const result = CustomerCommunitiesUpdateSchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};
