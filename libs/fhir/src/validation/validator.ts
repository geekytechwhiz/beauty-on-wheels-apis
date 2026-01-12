/**
 * FHIR Validation Wrapper
 * Provides runtime and CI/CD validation capabilities
 */

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  path: string;
  message: string;
  code?: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
  code?: string;
}

export interface ValidatorOptions {
  strict?: boolean;
  profile?: string;
}

/**
 * FHIR Validator
 * In production, this would integrate with a FHIR validation library
 * For Phase 1, provides basic structural validation
 */
export class FhirValidator {
  /**
   * Validate a FHIR resource
   */
  static validate(
    resource: unknown,
    options: ValidatorOptions = {}
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (!resource || typeof resource !== 'object') {
      errors.push({
        path: '/',
        message: 'Resource must be an object',
        code: 'INVALID_RESOURCE',
      });
      return { valid: false, errors, warnings };
    }

    const resourceObj = resource as Record<string, unknown>;

    if (!resourceObj.resourceType || typeof resourceObj.resourceType !== 'string') {
      errors.push({
        path: '/resourceType',
        message: 'Resource must have a resourceType property',
        code: 'MISSING_RESOURCE_TYPE',
      });
      return { valid: false, errors, warnings };
    }

    const resourceType = resourceObj.resourceType;

    if (!resourceObj.id || typeof resourceObj.id !== 'string') {
      warnings.push({
        path: '/id',
        message: 'Resource should have an id property',
        code: 'MISSING_ID',
      });
    }

    if (options.strict) {
      if (!resourceObj.meta) {
        warnings.push({
          path: '/meta',
          message: 'Resource should have meta property',
          code: 'MISSING_META',
        });
      }
    }

    if (options.profile) {
      if (
        !resourceObj.meta ||
        !(resourceObj.meta as Record<string, unknown>).profile ||
        !(resourceObj.meta as Record<string, unknown>).profile?.includes(options.profile)
      ) {
        warnings.push({
          path: '/meta/profile',
          message: `Resource should conform to profile: ${options.profile}`,
          code: 'PROFILE_MISMATCH',
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate and throw if invalid
   */
  static validateOrThrow(
    resource: unknown,
    options: ValidatorOptions = {}
  ): void {
    const result = this.validate(resource, options);
    if (!result.valid) {
      const errorMessages = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      throw new FhirValidationError(`FHIR validation failed: ${errorMessages}`, result);
    }
  }
}

/**
 * FHIR Validation Error
 */
export class FhirValidationError extends Error {
  constructor(
    message: string,
    public readonly validationResult: ValidationResult
  ) {
    super(message);
    this.name = 'FhirValidationError';
    Object.setPrototypeOf(this, FhirValidationError.prototype);
  }
}

