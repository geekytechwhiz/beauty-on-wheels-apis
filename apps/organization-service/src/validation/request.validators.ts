/**
 * Request validators for withLambdaHandler. Each receives the full request and throws
 * an error with statusCode (and optional code) when validation fails.
 */

import {
  createOrganizationSchema,
  getLinkedOrganizationsSchema,
  linkUnlinkOrganizationSchema,
  setOrgStatusSchema,
  updateOrganizationMetadataSchema,
} from './organization.validation';
import { normalizeOrganizationPayload } from '../utils/organizationPayload';

function throwValidationError(message: string, statusCode = 400, code = 'VALIDATION_ERROR', details?: any[]) {
  const err: any = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (details) err.details = details;
  throw err;
}

export function validateCreateOrganization(req: any) {
  const body = req?.body;
  if (body == null || typeof body !== 'object') {
    throwValidationError('Request body is required', 400, 'BAD_REQUEST');
  }
  const normalized = normalizeOrganizationPayload(body);
  if (normalized.data.adminDetails === undefined || normalized.data.adminDetails === null) {
    normalized.data.adminDetails = [];
  }
  if (normalized.errors.length > 0) {
    throwValidationError(
      'Validation failed',
      400,
      'VALIDATION_ERROR',
      normalized.errors.map((e) => ({ field: e.field, message: e.message ?? 'Invalid request body' })),
    );
  }
  const payloadForSchema = { ...normalized.data, organizationId: normalized.data.organizationId ?? 'x', createdBy: 'x' };
  const result = createOrganizationSchema.safeParse(payloadForSchema);
  if (!result.success) {
    const first = result.error.issues[0];
    throwValidationError(first?.message ?? 'Validation failed', 400, 'VALIDATION_ERROR');
  }
  (req as any).validatedCreateBody = normalized.data;
}

export function validateOrganizationIdParam(req: any) {
  const organizationId = req?.params?.organizationId;
  if (!organizationId || (typeof organizationId === 'string' && organizationId.trim() === '')) {
    throwValidationError('organizationId is required', 400, 'BAD_REQUEST');
  }
}

export function validateOrganizationIdAndUserIdParams(req: any) {
  const organizationId = req?.params?.organizationId;
  const userId = req?.params?.userId;
  if (!organizationId || (typeof organizationId === 'string' && organizationId.trim() === '')) {
    throwValidationError('organizationId is required', 400, 'BAD_REQUEST');
  }
  if (!userId || (typeof userId === 'string' && userId.trim() === '')) {
    throwValidationError('userId is required', 400, 'BAD_REQUEST');
  }
}

export function validateGetLinkedOrganizations(req: any) {
  const body = req?.body ?? {};
  const authorizer = req?.event?.requestContext?.authorizer;
  const userIdFromToken = authorizer?.userId ?? authorizer?.userID ?? authorizer?.claims?.sub ?? authorizer?.claims?.['custom:userID'];
  const payload = {
    organizationId: body.organizationId,
    orgType: body.orgType,
    userId: body.userId ?? userIdFromToken,
    preferredOrgId: body.preferredOrgId,
    limit: body.limit,
    nextPaginationKey: body.nextPaginationKey,
  };
  const result = getLinkedOrganizationsSchema.safeParse(payload);
  if (!result.success) {
    const first = result.error.issues[0];
    throwValidationError(first?.message ?? 'Validation failed', 400, 'VALIDATION_ERROR');
  }
}

export function validateLinkUnlinkOrganization(req: any) {
  const body = req?.body ?? {};
  const result = linkUnlinkOrganizationSchema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throwValidationError(first?.message ?? 'Validation failed', 400, 'VALIDATION_ERROR');
  }
}

export function validateSetOrgStatus(req: any) {
  const body = req?.body ?? {};
  const result = setOrgStatusSchema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throwValidationError(first?.message ?? 'Validation failed', 400, 'VALIDATION_ERROR');
  }
}

export function validateUpdateOrganizationMetadata(req: any) {
  const body = req?.body ?? {};
  const result = updateOrganizationMetadataSchema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throwValidationError(first?.message ?? 'Validation failed', 422, 'VALIDATION_ERROR');
  }
}

export function validateMetadataTypeParam(req: any) {
  const type = req?.params?.type?.toUpperCase() || 'ORGANIZATION';
  if (type !== 'ROOT' && type !== 'ORGANIZATION') {
    throwValidationError('type must be ROOT or ORGANIZATION', 400, 'INVALID_TYPE');
  }
}

export function validateOrganizationListPost(req: any) {
  const method = (req?.event?.httpMethod || '').toUpperCase();
  if (method !== 'POST') {
    const err: any = new Error('Only POST method is allowed');
    err.statusCode = 405;
    err.code = 'METHOD_NOT_ALLOWED';
    throw err;
  }
}
