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
  public readonly context?: Record<string, unknown>;
  /** Dot-path into template config/document when validation is field-scoped. */
  public readonly fieldPath?: string;
  /** Registry metadata name when validation is metadata-driven. */
  public readonly metadataKey?: string;

  constructor(
    message: string,
    code = 'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
    details?: TemplateErrorDetails,
    context?: Record<string, unknown>,
    fieldPath?: string,
    metadataKey?: string,
  ) {
    super(code, message, 400, details);
    this.context = context;
    this.fieldPath = fieldPath;
    this.metadataKey = metadataKey;
  }

  /** Alias for {@link TemplateError.code} — stable validation error codes. */
  get errorCode(): string {
    return this.code;
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

export class TemplateInvalidStateTransitionError extends TemplateError {
  constructor(message = 'Invalid template state transition') {
    super('TEMPLATE.TEMPLATE_INVALID_STATE_TRANSITION', message, 409);
  }
}

export class TemplateSchemaRefMissingError extends TemplateError {
  constructor(message = 'Template schema reference is missing') {
    super('TEMPLATE.TEMPLATE_SCHEMA_REF_MISSING', message, 500);
  }
}

export class TemplateRuntimeBindingConflictError extends TemplateError {
  constructor(message = 'Runtime template version is already bound') {
    super('TEMPLATE.TEMPLATE_RUNTIME_BINDING_CONFLICT', message, 409);
  }
}

export class TemplateNotPublishedError extends TemplateError {
  constructor(message = 'Template must be PUBLISHED for this operation') {
    super('TEMPLATE.TEMPLATE_NOT_PUBLISHED', message, 409);
  }
}

export class TemplateHierarchyError extends TemplateError {
  constructor(message = 'Invalid template hierarchy') {
    super('TEMPLATE.TEMPLATE_HIERARCHY_INVALID', message, 400);
  }
}

export class MetadataNotFoundError extends TemplateError {
  constructor(message = 'Metadata definition not found') {
    super('METADATA.NOT_FOUND', message, 404);
  }
}

export class MetadataDefinitionConflictError extends TemplateError {
  constructor(message = 'Metadata definition already exists for this type, name, and version') {
    super('METADATA.ALREADY_EXISTS', message, 409);
  }
}
