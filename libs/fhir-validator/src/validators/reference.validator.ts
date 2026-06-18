import objectPath from 'object-path';

import { mappingRegistry } from '@api-hub/fhir';

import { ValidationIssue } from '../models/validation-issue';
import { ValidationResult } from '../models/validation-result';

function referenceValue(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value === 'object' && value !== null && 'reference' in value) {
    const ref = (value as { reference?: unknown }).reference;
    return typeof ref === 'string' ? ref : undefined;
  }

  return typeof value === 'string' ? value : String(value);
}

export class ReferenceValidator {
  validate(resource: Record<string, unknown>, version = 'R4'): ValidationResult {
    const resourceType =
      typeof resource?.resourceType === 'string' ? resource.resourceType : undefined;
    if (!resourceType) {
      return { valid: true, issues: [] };
    }

    const mapping = mappingRegistry.get(resourceType, version);
    const issues: ValidationIssue[] = [];

    for (const field of mapping?.fields ?? []) {
      if (field.fieldType !== 'reference') {
        continue;
      }

      const value = objectPath.get(resource, field.target);
      const refStr = referenceValue(value);
      if (!refStr) {
        continue;
      }

      if (!refStr.includes('/')) {
        issues.push({
          validator: 'ReferenceValidator',
          resourceType,
          path: field.target,
          code: 'INVALID_REFERENCE',
          message: 'Reference must follow Resource/id format',
        });
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
