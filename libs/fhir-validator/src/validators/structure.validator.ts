import { ValidationResult } from '../models/validation-result';
import { ValidationIssue } from '../models/validation-issue';

export class StructureValidator {
  constructor(private readonly metadataRegistry: any) {}

  validate(resource: any): ValidationResult {
    const metadata = this.metadataRegistry.get(resource.resourceType);
    const issues: ValidationIssue[] = [];

    if (!metadata?.fields) {
      return { valid: true, issues };
    }

    for (const field of metadata.fields) {
      const value = resource[field.name];

      if (field.required && (value === undefined || value === null)) {
        issues.push({
          validator: 'StructureValidator',
          resourceType: resource.resourceType,
          path: field.path,
          code: 'REQUIRED',
          message: `${field.path} is required`,
        });
      }
    }

    return { valid: issues.length === 0, issues };
  }
}