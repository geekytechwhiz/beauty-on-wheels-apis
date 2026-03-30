export type TemplateErrorDetails = Array<{ field?: string; message: string }>;

export class TemplateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: TemplateErrorDetails,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class TemplateValidationError extends TemplateError {
  constructor(message: string, code = 'TEMPLATE.TEMPLATE_VALIDATION_FAILED', details?: TemplateErrorDetails) {
    super(code, message, 400, details);
  }
}

export class TemplateUnauthorizedError extends TemplateError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class TemplateNotFoundError extends TemplateError {
  constructor(message = 'Template not found') {
    super('TEMPLATE.TEMPLATE_NOT_FOUND', message, 404);
  }
}

export class TemplateVersionExistsError extends TemplateError {
  constructor(message = 'Template version already exists') {
    super('TEMPLATE.TEMPLATE_VERSION_EXISTS', message, 409);
  }
}

export class TemplateVersionConflictError extends TemplateError {
  constructor(message = 'Template version conflict') {
    super('TEMPLATE.TEMPLATE_VERSION_CONFLICT', message, 409);
  }
}

export class TemplateResolveError extends TemplateError {
  constructor(message = 'Template resolve failed') {
    super('TEMPLATE.TEMPLATE_RESOLVE_FAILED', message, 400);
  }
}

export class TemplateSchemaRefMissingError extends TemplateError {
  constructor(message = 'Template schema reference is missing') {
    super('TEMPLATE.TEMPLATE_SCHEMA_REF_MISSING', message, 500);
  }
}
