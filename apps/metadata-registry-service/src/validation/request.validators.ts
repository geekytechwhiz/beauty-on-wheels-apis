/**
 * Request validators for withLambdaHandler. Each receives the full request and throws
 * an error with statusCode (and optional code) when validation fails.
 */

import {
  createMetadataTypeSchema,
  createMetadataValueSchema,
  listMetadataValuesQuerySchema,
  updateMetadataTypeSchema,
  updateMetadataValueSchema,
  validateMetadataValueBodySchema,
} from '@api-hub/metadata';

function throwValidationError(
  message: string,
  statusCode = 400,
  code = 'VALIDATION_ERROR',
  details?: { field?: string; message: string }[],
): never {
  const err = new Error(message) as Error & { statusCode: number; code: string; details?: typeof details };
  err.statusCode = statusCode;
  err.code = code;
  if (details) err.details = details;
  throw err;
}

export function validateCreateMetadataType(req: { body?: unknown }): void {
  const body = req?.body;
  if (body == null || typeof body !== 'object') {
    throwValidationError('Request body is required', 400, 'BAD_REQUEST');
  }
  const result = createMetadataTypeSchema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throwValidationError(first?.message ?? 'Validation failed', 400, 'VALIDATION_ERROR');
  }
  (req as { validatedCreateMetadataTypeBody: typeof result.data }).validatedCreateMetadataTypeBody = result.data;
}

export function validateUpdateMetadataType(req: { body?: unknown; params?: Record<string, string | undefined> }): void {
  const metadataTypeCode = req?.params?.metadataTypeCode;
  if (!metadataTypeCode || String(metadataTypeCode).trim() === '') {
    throwValidationError('metadataTypeCode is required', 400, 'BAD_REQUEST');
  }
  const body = req?.body;
  if (body == null || typeof body !== 'object') {
    throwValidationError('Request body is required', 400, 'BAD_REQUEST');
  }
  const result = updateMetadataTypeSchema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throwValidationError(first?.message ?? 'Validation failed', 400, 'VALIDATION_ERROR');
  }
  (req as { validatedUpdateMetadataTypeBody: typeof result.data }).validatedUpdateMetadataTypeBody = result.data;
}

export function validateMetadataTypeCodeParam(req: { params?: Record<string, string | undefined> }): void {
  const metadataTypeCode = req?.params?.metadataTypeCode;
  if (!metadataTypeCode || String(metadataTypeCode).trim() === '') {
    throwValidationError('metadataTypeCode is required', 400, 'BAD_REQUEST');
  }
}

export function validateMetadataTypeAndValueParams(req: { params?: Record<string, string | undefined> }): void {
  const metadataTypeCode = req?.params?.metadataTypeCode;
  const metadataValueCode = req?.params?.metadataValueCode;
  if (!metadataTypeCode || String(metadataTypeCode).trim() === '') {
    throwValidationError('metadataTypeCode is required', 400, 'BAD_REQUEST');
  }
  if (!metadataValueCode || String(metadataValueCode).trim() === '') {
    throwValidationError('metadataValueCode is required', 400, 'BAD_REQUEST');
  }
}

export function validateCreateMetadataValue(req: { body?: unknown; params?: Record<string, string | undefined> }): void {
  validateMetadataTypeCodeParam(req);
  const body = req?.body;
  if (body == null || typeof body !== 'object') {
    throwValidationError('Request body is required', 400, 'BAD_REQUEST');
  }
  const result = createMetadataValueSchema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throwValidationError(first?.message ?? 'Validation failed', 400, 'VALIDATION_ERROR');
  }
  (req as { validatedCreateMetadataValueBody: typeof result.data }).validatedCreateMetadataValueBody = result.data;
}

export function validateUpdateMetadataValue(req: { body?: unknown; params?: Record<string, string | undefined> }): void {
  validateMetadataTypeAndValueParams(req);
  const body = req?.body;
  if (body == null || typeof body !== 'object') {
    throwValidationError('Request body is required', 400, 'BAD_REQUEST');
  }
  const result = updateMetadataValueSchema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throwValidationError(first?.message ?? 'Validation failed', 400, 'VALIDATION_ERROR');
  }
  (req as { validatedUpdateMetadataValueBody: typeof result.data }).validatedUpdateMetadataValueBody = result.data;
}

export function validateListMetadataValuesByContext(req: { params?: Record<string, string | undefined> }): void {
  validateMetadataTypeCodeParam(req);
  const p = req.params ?? {};
  const result = listMetadataValuesQuerySchema.safeParse({
    module: p.module,
    category: p.category,
    condition: p.condition,
    country: p.country,
  });
  if (!result.success) {
    const first = result.error.issues[0];
    throwValidationError(first?.message ?? 'Validation failed', 400, 'VALIDATION_ERROR');
  }
  (req as { validatedApplicabilityContext: typeof result.data }).validatedApplicabilityContext = result.data;
}

export function validateValidateMetadataValue(req: { body?: unknown }): void {
  const body = req?.body;
  if (body == null || typeof body !== 'object') {
    throwValidationError('Request body is required', 400, 'BAD_REQUEST');
  }
  const result = validateMetadataValueBodySchema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throwValidationError(first?.message ?? 'Validation failed', 400, 'VALIDATION_ERROR');
  }
  (req as { validatedValidateMetadataValueBody: typeof result.data }).validatedValidateMetadataValueBody = result.data;
}
