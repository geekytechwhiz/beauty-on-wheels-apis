import objectPath from 'object-path';

import { getRequiredFields } from '../registry/resource-metadata.registry';

export interface ValidateResourceInput {
  resource: any;

  resourceType: string;

  version?: string;

  profile?: string;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';

  code: string;

  diagnostics: string;

  field?: string;
}

export class FhirValidationError extends Error {
  readonly statusCode = 422;

  readonly code = 'FHIR_VALIDATION_FAILED';

  constructor(
    public readonly issues: ValidationIssue[],
    public readonly resourceType?: string,
  ) {
    super(issues.map((x) => x.diagnostics).join(', '));
  }
}

export class FhirValidator {
  /**
   * Main entry point
   */
  async validateResource(input: ValidateResourceInput): Promise<void> {
    const issues: ValidationIssue[] = [];

    issues.push(...this.validateBasicStructure(input));

    issues.push(...this.validateRequiredFields(input));

    /**
     * Future:
     *
     * issues.push(
     *   ...await this.validateProfile()
     * )
     *
     * issues.push(
     *   ...await this.validateTerminology()
     * )
     *
     */

    const errors = issues.filter((x) => x.severity === 'error');

    if (errors.length) {
      throw new FhirValidationError(errors, input.resourceType);
    }
  }

  /**
   * Basic FHIR checks
   */
  private validateBasicStructure(
    input: ValidateResourceInput,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!input.resource) {
      issues.push({
        severity: 'error',

        code: 'RESOURCE_MISSING',

        diagnostics: 'FHIR resource missing',
      });

      return issues;
    }

    if (input.resource.resourceType !== input.resourceType) {
      issues.push({
        severity: 'error',

        code: 'INVALID_RESOURCE_TYPE',

        diagnostics: `Expected ${input.resourceType}
           but received
           ${input.resource.resourceType}`,
      });
    }

    return issues;
  }

  /**
   * Required field checks
   */
  private validateRequiredFields(
    input: ValidateResourceInput,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    const requiredFields = getRequiredFields(
      input.resourceType,
      input.version ?? 'R4',
    );

    for (const field of requiredFields) {
      const value = objectPath.get(input.resource, field);

      const empty = value === undefined || value === null || value === '';

      if (empty) {
        issues.push({
          severity: 'error',

          code: 'REQUIRED_FIELD_MISSING',

          diagnostics: `Required field missing: ${field}`,

          field,
        });
      }
    }

    return issues;
  }
}
