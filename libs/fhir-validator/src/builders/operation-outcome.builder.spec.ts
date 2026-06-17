import { buildOperationOutcome } from './operation-outcome.builder';
import type { ValidationIssue } from '../models/validation-issue';

describe('buildOperationOutcome', () => {
  it('classifies terminology issues with value code and warning severity when non-blocking', () => {
    const issues: ValidationIssue[] = [
      {
        validator: 'TerminologyValidator',
        resourceType: 'Patient',
        path: 'gender',
        code: 'INVALID_CODE',
        message:
          "Invalid code 'animal' for http://hl7.org/fhir/administrative-gender",
      },
    ];

    const outcome = buildOperationOutcome(issues, {
      resourceType: 'Patient',
      nonBlocking: true,
    });

    expect(outcome).toEqual({
      resourceType: 'OperationOutcome',
      issue: [
        {
          severity: 'warning',
          code: 'value',
          category: 'terminology',
          validator: 'TerminologyValidator',
          diagnostics:
            "Invalid code 'animal' for http://hl7.org/fhir/administrative-gender",
          expression: ['Patient.gender'],
        },
      ],
    });
  });

  it('classifies structure and reference issues as errors when blocking', () => {
    const issues: ValidationIssue[] = [
      {
        validator: 'StructureValidator',
        resourceType: 'Patient',
        path: 'name',
        code: 'REQUIRED',
        message: 'Required field missing: name',
      },
      {
        validator: 'ReferenceValidator',
        resourceType: 'Patient',
        path: 'managingOrganization.reference',
        code: 'INVALID_REFERENCE',
        message: 'Reference must follow Resource/id format',
      },
    ];

    const outcome = buildOperationOutcome(issues, { resourceType: 'Patient' });

    expect(outcome.issue).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'required',
        category: 'structure',
        expression: ['Patient.name'],
      }),
      expect.objectContaining({
        severity: 'error',
        code: 'invalid',
        category: 'reference',
        expression: ['Patient.managingOrganization.reference'],
      }),
    ]);
  });
});
