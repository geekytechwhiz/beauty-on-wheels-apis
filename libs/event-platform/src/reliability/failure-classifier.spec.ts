import { ZodError, z } from 'zod';

import { EventValidationError } from '../core/event-envelope/validate-base-event';
import { classifyFailure } from './failure-classifier';
import { NonRetryableError, RetryableError, SchemaError } from './errors';

describe('classifyFailure', () => {
  it('treats schema and validation failures as non-retryable', () => {
    expect(classifyFailure(new EventValidationError('bad json'))).toBe('non_retryable');
    expect(classifyFailure(new SchemaError('unknown event'))).toBe('non_retryable');
    expect(classifyFailure(new ZodError([]))).toBe('non_retryable');
    expect(() => z.object({ email: z.string().email() }).parse({ email: 'nope' })).toThrow(
      ZodError,
    );
  });

  it('treats explicit retryable errors as retryable', () => {
    expect(classifyFailure(new RetryableError('throttle'))).toBe('retryable');
    expect(classifyFailure(new NonRetryableError('rejected'))).toBe('non_retryable');
    expect(classifyFailure(new Error('socket hang up'))).toBe('retryable');
  });
});
