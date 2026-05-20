import { ZodError } from 'zod';

import { BaseError } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

import { DependencyError, NonRetryableError, RetryableError, SchemaError } from './errors';

export function classifyFailure(error: unknown): 'retryable' | 'non_retryable' {
  if (error instanceof RetryableError || error instanceof DependencyError) {
    return 'retryable';
  }
  if (
    error instanceof NonRetryableError ||
    error instanceof SchemaError ||
    error instanceof EventSchemaError
  ) {
    return 'non_retryable';
  }
  if (error instanceof BaseError) {
    if (error.retryable === false) {
      return 'non_retryable';
    }
    if (error.retryable === true) {
      return 'retryable';
    }
  }
  if (error instanceof ZodError) {
    return 'non_retryable';
  }
  if (error instanceof Error) {
    const n = error.name;
    if (n === 'ValidationError' || n === 'SchemaValidationError' || n === 'SchemaError') {
      return 'non_retryable';
    }
  }
  return 'retryable';
}

export function isNonRetryableFailure(error: unknown): boolean {
  return classifyFailure(error) === 'non_retryable';
}
