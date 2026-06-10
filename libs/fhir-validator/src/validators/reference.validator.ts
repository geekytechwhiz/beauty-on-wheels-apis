import { ValidationIssue } from '../models/validation-issue';
import { ValidationResult } from '../models/validation-result';

export class ReferenceValidator {
  constructor(private readonly mappingRegistry: any) {}

  validate(resource: any): ValidationResult {
    const mapping = this.mappingRegistry.get(resource.resourceType);
    const issues: ValidationIssue[] = [];

    for (const field of mapping?.fields ?? []) {
      if (field.fieldType !== 'reference') continue;

      const value = resource[field.target];
      if (!value) continue;

      if (!String(value).includes('/')) {
        issues.push({
          validator: 'ReferenceValidator',
          resourceType: resource.resourceType,
          path: field.target,
          code: 'INVALID_REFERENCE',
          message: 'Reference must follow Resource/id format',
        });
      }
    }

    return { valid: issues.length === 0, issues };
  }
}