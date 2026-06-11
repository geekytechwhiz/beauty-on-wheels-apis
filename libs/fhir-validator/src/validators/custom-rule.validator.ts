import { ValidationResult } from '../models/validation-result';

export class CustomRuleValidator {
  validate(_resource: Record<string, unknown>, _version = 'R4'): ValidationResult {
    return { valid: true, issues: [] };
  }
}