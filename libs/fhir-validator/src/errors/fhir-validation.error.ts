import { ValidationIssue } from '../models/validation-issue';

export class FhirValidationError extends Error {
  readonly statusCode = 422;

  readonly code = 'FHIR_VALIDATION_FAILED';

  constructor(
    public readonly issues: ValidationIssue[],
    public readonly resourceType?: string,
  ) {
    super(
      issues.map((issue) => issue.message).join(', ') || 'FHIR validation failed',
    );
    this.name = 'FhirValidationError';
  }
}
