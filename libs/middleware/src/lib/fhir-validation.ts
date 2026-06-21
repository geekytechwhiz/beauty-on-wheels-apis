import type { Logger } from '@api-hub/observability';
import {
  buildOperationOutcome,
  FhirValidationError,
  getFhirValidator,
  type ValidationIssue,
  type ValidationResult,
} from '@api-hub/fhir-validator';

import type { FhirValidationOptions } from './fhir-peer';

export interface FhirValidationOutcome {
  valid: boolean;
  operationOutcome: ReturnType<typeof buildOperationOutcome>;
}

function inferResourceType(
  resource: Record<string, unknown>,
): string | undefined {
  if (resource.resourceType === 'Bundle' && Array.isArray(resource.entry)) {
    for (const entry of resource.entry) {
      const nested = (entry as { resource?: { resourceType?: string } })
        ?.resource?.resourceType;
      if (typeof nested === 'string' && nested.trim() !== '') {
        return nested.trim();
      }
    }
  }

  return typeof resource.resourceType === 'string'
    ? resource.resourceType
    : undefined;
}

export function runFhirValidation(
  resource: Record<string, unknown>,
  validation: FhirValidationOptions | undefined,
  logger?: Logger,
): FhirValidationOutcome | undefined {
  if (validation?.enabled !== true) {
    return undefined;
  }

  const validator = getFhirValidator();
  const validationResult = validator.validate(resource);

  if (validationResult.valid) {
    return undefined;
  }

  const resourceType = inferResourceType(resource);
  const nonBlocking = validation.failOnValidationError === false;
  const operationOutcome = buildOperationOutcome(validationResult.issues, {
    resourceType,
    nonBlocking,
  });

  if (nonBlocking) {
    logger?.warn?.({
      event: 'fhir_validation_warning',
      resourceType,
      issues: validationResult.issues,
      operationOutcome,
    });

    return {
      valid: false,
      operationOutcome,
    };
  }

  throw new FhirValidationError(
    validationResult.issues as ValidationIssue[],
    resourceType,
  );
}

export type { ValidationResult };
