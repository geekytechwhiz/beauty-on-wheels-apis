import { BaseError } from '@api-hub/utils';
import { NonRetryableError, RetryableError } from '@api-hub/event-platform';

export class EmailValidationError extends NonRetryableError {
  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(message, { ...options, code: options?.code ?? 'EMAIL_VALIDATION_ERROR' });
    this.name = 'EmailValidationError';
  }
}

export class TemplateNotFoundError extends NonRetryableError {
  constructor(templateName: string) {
    super(`Template '${templateName}' was not found`, {
      code: 'TEMPLATE_NOT_FOUND',
    });
    this.name = 'TemplateNotFoundError';
  }
}

export class TemplateInactiveError extends NonRetryableError {
  constructor(templateName: string) {
    super(`Template '${templateName}' is inactive`, {
      code: 'TEMPLATE_INACTIVE',
    });
    this.name = 'TemplateInactiveError';
  }
}

export class TemplateParameterValidationError extends NonRetryableError {
  constructor(message: string) {
    super(message, { code: 'TEMPLATE_PARAMETER_VALIDATION' });
    this.name = 'TemplateParameterValidationError';
  }
}

export class TemplateRenderError extends NonRetryableError {
  constructor(message: string) {
    super(message, { code: 'TEMPLATE_RENDER_ERROR' });
    this.name = 'TemplateRenderError';
  }
}

export class EmailRecipientError extends NonRetryableError {
  constructor(message: string) {
    super(message, { code: 'EMAIL_RECIPIENT_ERROR' });
    this.name = 'EmailRecipientError';
  }
}

export class EmailConfigurationError extends NonRetryableError {
  constructor(message: string) {
    super(message, { code: 'EMAIL_CONFIGURATION_ERROR' });
    this.name = 'EmailConfigurationError';
  }
}

export class SesRetryableError extends RetryableError {
  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(message, { ...options, code: options?.code ?? 'SES_RETRYABLE' });
    this.name = 'SesRetryableError';
  }
}

export class SesPermanentError extends NonRetryableError {
  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(message, { ...options, code: options?.code ?? 'SES_PERMANENT' });
    this.name = 'SesPermanentError';
  }
}

export class IdempotencyConflictError extends BaseError {
  constructor(message: string, retryable: boolean) {
    super(message, retryable ? 409 : 422, 'IDEMPOTENCY_CONFLICT', undefined, {
      retryable,
    });
    this.name = 'IdempotencyConflictError';
  }
}

export class DeliveryStoreError extends RetryableError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { ...options, code: 'DELIVERY_STORE_ERROR' });
    this.name = 'DeliveryStoreError';
  }
}
