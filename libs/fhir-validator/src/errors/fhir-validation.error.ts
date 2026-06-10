import { ValidationIssue } from '../models/validation-issue';

export class FhirValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super('FHIR validation failed');
  }
}
