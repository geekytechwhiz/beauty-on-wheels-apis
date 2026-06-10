import { ValidationResult } from '../models/validation-result';

export class CustomRuleValidator {
  validate(resource: any): ValidationResult {
    return { valid: true, issues: [] };
  }
}