import { LambdaRequest, ValidationError } from '@api-hub/utils';

export function validateEmailVerificationRequest(request: LambdaRequest) {
  const token = (request.body as { token?: unknown } | undefined)?.token;
  if (typeof token !== 'string' || !token.trim() || token.length > 1024) {
    throw new ValidationError('token is required');
  }
  request.body = { token: token.trim() };
}
