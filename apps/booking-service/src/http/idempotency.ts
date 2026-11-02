import { LambdaRequest, ValidationError } from '@api-hub/utils';

import { headerValue } from '../auth/access';

/** Idempotency-Key header. Required on every mutating route added for issues, evidence, and review. */
export function requireIdempotencyKey(request: LambdaRequest): string {
  const key = headerValue(request, 'Idempotency-Key');
  if (!key || key.length > 128) throw new ValidationError('Idempotency-Key header is required');
  return key;
}

export function requirePathParam(request: LambdaRequest, name: string): string {
  const value = request.pathParameters?.[name]?.trim();
  if (!value) throw new ValidationError(`${name} is required`);
  return value;
}
