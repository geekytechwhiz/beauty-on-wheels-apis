import { ValidationResult } from '../models/validation-result';
import { ValidationIssue } from '../models/validation-issue';

export class TerminologyValidator {
  constructor(private readonly mappingRegistry: any, private readonly terminologyRegistry: any) {}

  validate(resource: any): ValidationResult {
    const mapping = this.mappingRegistry.get(resource.resourceType);
    const issues: ValidationIssue[] = [];

    for (const field of mapping?.fields ?? []) {
      if (field.fieldType !== 'code' || !field.system) continue;

      const value = resource[field.target];
      if (value === undefined) continue;

      const allowed = this.terminologyRegistry.get(field.system) ?? [];

      if (!allowed.includes(value)) {
        issues.push({
          validator: 'TerminologyValidator',
          resourceType: resource.resourceType,
          path: field.target,
          code: 'INVALID_CODE',
          message: `Invalid code '${value}' for ${field.system}`,
        });
      }
    }

    return { valid: issues.length === 0, issues };
  }
}