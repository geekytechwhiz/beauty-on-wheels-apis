import { buildOperationOutcome } from './operation-outcome.builder';
import type { ValidationIssue } from './fhir.validator';

describe('buildOperationOutcome', () => {
  it('builds OperationOutcome from validation issues', () => {
    const issues: ValidationIssue[] = [
      {
        severity: 'error',
        code: 'REQUIRED_FIELD_MISSING',
        diagnostics: 'Required field missing: status',
        field: 'status',
      },
      {
        severity: 'warning',
        code: 'PROFILE_MISMATCH',
        diagnostics: 'Profile not validated',
      },
    ];

    const outcome = buildOperationOutcome(issues, 'Observation');

    expect(outcome).toEqual({
      resourceType: 'OperationOutcome',
      issue: [
        {
          severity: 'error',
          code: 'required',
          diagnostics: 'Required field missing: status',
          expression: ['Observation.status'],
        },
        {
          severity: 'warning',
          code: 'invalid',
          diagnostics: 'Profile not validated',
        },
      ],
    });
  });

  it('maps INVALID_RESOURCE_TYPE to expression on resourceType', () => {
    const outcome = buildOperationOutcome(
      [
        {
          severity: 'error',
          code: 'INVALID_RESOURCE_TYPE',
          diagnostics: 'Expected Patient but received Organization',
        },
      ],
      'Patient',
    );

    expect(outcome.issue[0]).toMatchObject({
      code: 'invalid',
      expression: ['Patient.resourceType'],
    });
  });

  it('maps RESOURCE_MISSING to resource-level expression', () => {
    const outcome = buildOperationOutcome(
      [
        {
          severity: 'error',
          code: 'RESOURCE_MISSING',
          diagnostics: 'FHIR resource missing',
        },
      ],
      'Patient',
    );

    expect(outcome.issue[0]).toMatchObject({
      code: 'required',
      expression: ['Patient'],
    });
  });
});
