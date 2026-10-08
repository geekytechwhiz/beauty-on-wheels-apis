import { SesPermanentError, SesRetryableError } from '../domain/errors.js';

const PERMANENT_NAMES = new Set([
  'MessageRejected',
  'MailFromDomainNotVerifiedException',
  'AccountSuspendedException',
  'ConfigurationSetDoesNotExistException',
  'ConfigurationSetDoesNotExist',
  'InvalidParameterValue',
  'InvalidParameterException',
  'NotFoundException',
  'AccessDeniedException',
  'ValidationException',
]);

const RETRYABLE_NAMES = new Set([
  'Throttling',
  'ThrottlingException',
  'TooManyRequestsException',
  'LimitExceededException',
  'ServiceUnavailable',
  'ServiceUnavailableException',
  'InternalFailure',
  'InternalServerError',
  'InternalServerErrorException',
  'RequestTimeout',
  'TimeoutError',
  'NetworkingError',
  'ECONNRESET',
  'EAI_AGAIN',
  'ETIMEDOUT',
]);

export function classifySesError(error: unknown): SesRetryableError | SesPermanentError {
  const name = errorName(error);
  const status = httpStatus(error);
  const safeMessage = redactEmails(errorMessage(error));

  if (RETRYABLE_NAMES.has(name) || status === 429 || (status !== undefined && status >= 500)) {
    return new SesRetryableError(safeMessage || `SES temporarily failed (${name})`, {
      code: name,
      cause: error,
    });
  }
  if (PERMANENT_NAMES.has(name) || (status !== undefined && status >= 400 && status < 500)) {
    return new SesPermanentError(safeMessage || `SES rejected the email (${name})`, {
      code: name,
      cause: error,
    });
  }
  return new SesRetryableError(safeMessage || `SES request failed (${name})`, {
    code: name,
    cause: error,
  });
}

function errorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
    return error.name;
  }
  return 'UnknownError';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return errorName(error);
}

function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('$metadata' in error)) {
    return undefined;
  }
  const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return metadata?.httpStatusCode;
}

export function redactEmails(value: string): string {
  return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
}

export function sesTagValue(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);
  return cleaned.length > 0 ? cleaned : 'unknown';
}
