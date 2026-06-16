import objectPath from 'object-path';

import { getRequiredFields } from '@api-hub/fhir';

import { ValidationIssue } from '../models/validation-issue';
import { ValidationResult } from '../models/validation-result';

export class StructureValidator {
  validate(resource: Record<string, unknown>, version = 'R4'): ValidationResult {
    const issues: ValidationIssue[] = [];
    const resourceType =
      typeof resource?.resourceType === 'string' ? resource.resourceType : undefined;

    if (!resourceType) {
      issues.push({
        validator: 'StructureValidator',
        resourceType: 'Unknown',
        path: 'resourceType',
        code: 'RESOURCE_MISSING',
        message: 'FHIR resource missing resourceType',
      });
      return { valid: false, issues };
    }

    if (resource.resourceType !== resourceType) {
      issues.push({
        validator: 'StructureValidator',
        resourceType,
        path: 'resourceType',
        code: 'INVALID_RESOURCE_TYPE',
        message: `Expected ${resourceType} but received ${String(resource.resourceType)}`,
      });
    }

    const requiredFields = getRequiredFields(resourceType, version);
    for (const field of requiredFields) {
      const value = objectPath.get(resource, field);
      const empty = value === undefined || value === null || value === '';

      if (empty) {
        issues.push({
          validator: 'StructureValidator',
          resourceType,
          path: field,
          code: 'REQUIRED',
          message: `Required field missing: ${field}`,
        });
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
