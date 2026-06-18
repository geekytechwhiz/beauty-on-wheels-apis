import { BaseError } from './base.error';
import { toBaseError } from './normalize-error';

/** Simulates esbuild-bundled BaseError that lost the native Error prototype chain. */
function brokenPrototypeError(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return Object.assign(Object.create(null), fields);
}

describe('toBaseError', () => {
  it('preserves statusCode and code from error-like plain objects', () => {
    const broken = brokenPrototypeError({
      name: 'Error',
      message: 'Invalid input: expected object, received undefined',
      stack: 'Error: Invalid input\n    at validate',
      code: 'VALIDATION_ERROR',
      statusCode: 422,
      details: [{ field: 'userInfo', message: 'userInfo is required' }],
    });

    const result = toBaseError(broken);

    expect(result).toBeInstanceOf(BaseError);
    expect(result.statusCode).toBe(422);
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.message).toBe(
      'Invalid input: expected object, received undefined',
    );
    expect(result.details).toEqual([
      { field: 'userInfo', message: 'userInfo is required' },
    ]);
  });

  it('re-normalizes BaseError without downgrading to 500', () => {
    const original = new BaseError(
      'Validation failed',
      422,
      'VALIDATION_ERROR',
      [{ field: 'userInfo', message: 'required' }],
      { retryable: false },
    );

    const broken = brokenPrototypeError({
      name: original.name,
      message: original.message,
      stack: original.stack,
      code: original.code,
      statusCode: original.statusCode,
      details: original.details,
      retryable: original.retryable,
    });

    const result = toBaseError(broken);

    expect(result.statusCode).toBe(422);
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('falls through to 500 for non-error objects', () => {
    const result = toBaseError({ foo: 'bar' });

    expect(result.statusCode).toBe(500);
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toBe('Unexpected non-Error rejection');
  });

  it('maps AWS access denied errors to 403 FORBIDDEN', () => {
    const denied = new Error(
      'User: arn:aws:iam::542476693486:user/example is not authorized to perform: dynamodb:GetItem on resource: arn:aws:dynamodb:us-east-1:542476693486:table/template-service-dev with an explicit deny in an identity-based policy',
    );
    denied.name = 'AccessDeniedException';

    const result = toBaseError(denied);

    expect(result.statusCode).toBe(403);
    expect(result.code).toBe('FORBIDDEN');
  });
});
