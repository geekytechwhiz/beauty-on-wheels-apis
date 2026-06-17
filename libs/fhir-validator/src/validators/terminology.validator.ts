import objectPath from 'object-path';

import { mappingRegistry } from '@api-hub/fhir';
import {
  defaultTerminologyService,
  isValidCodeFormat,
} from '@api-hub/terminology';

import { ValidationIssue } from '../models/validation-issue';
import { ValidationResult } from '../models/validation-result';

function isAllowedCode(system: string, value: string): boolean {
  const normalized = defaultTerminologyService.normalizeCode(system, value);
  if (normalized.known) {
    return true;
  }

  return isValidCodeFormat(system, value);
}

export class TerminologyValidator {
  validate(resource: Record<string, unknown>, version = 'R4'): ValidationResult {
    const resourceType =
      typeof resource?.resourceType === 'string' ? resource.resourceType : undefined;
    if (!resourceType) {
      return { valid: true, issues: [] };
    }

    const mapping = mappingRegistry.get(resourceType, version);
    const issues: ValidationIssue[] = [];

    for (const field of mapping?.fields ?? []) {
      if (field.fieldType !== 'code' || !field.system) {
        continue;
      }

      const value = objectPath.get(resource, field.target);
      if (value === undefined || value === null || value === '') {
        continue;
      }

      const codeValue = String(value);
      if (!isAllowedCode(field.system, codeValue)) {
        issues.push({
          validator: 'TerminologyValidator',
          resourceType,
          path: field.target,
          code: 'INVALID_CODE',
          message: `Invalid code '${codeValue}' for ${field.system}`,
        });
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
