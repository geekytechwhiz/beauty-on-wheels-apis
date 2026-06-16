import { ValidationIssue } from './validation-issue';

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}