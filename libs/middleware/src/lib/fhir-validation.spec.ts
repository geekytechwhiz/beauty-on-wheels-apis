import { FhirValidationError } from '@api-hub/fhir-validator';

import { runFhirValidation } from './fhir-validation';

describe('runFhirValidation', () => {
  it('throws FhirValidationError with OperationOutcome-compatible fields', () => {
    expect(() =>
      runFhirValidation(
        {
          resourceType: 'Patient',
          id: 'patient-1',
          gender: 'jisna',
        },
        { enabled: true, failOnValidationError: true },
      ),
    ).toThrow(FhirValidationError);

    try {
      runFhirValidation(
        {
          resourceType: 'Patient',
          id: 'patient-1',
          gender: 'jisna',
        },
        { enabled: true, failOnValidationError: true },
      );
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 422,
        code: 'FHIR_VALIDATION_FAILED',
        resourceType: 'Patient',
      });
    }
  });

  it('returns classified OperationOutcome when failOnValidationError is false', () => {
    const outcome = runFhirValidation(
      {
        resourceType: 'Patient',
        id: 'patient-1',
        gender: 'jisna',
      },
      { enabled: true, failOnValidationError: false },
    );

    expect(outcome?.valid).toBe(false);
    expect(outcome?.operationOutcome.resourceType).toBe('OperationOutcome');
    expect(outcome?.operationOutcome.issue[0]).toEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'value',
        category: 'terminology',
        validator: 'TerminologyValidator',
        expression: ['Patient.gender'],
        diagnostics: expect.stringContaining('jisna'),
      }),
    );
  });

  it('does not throw when validation is disabled', () => {
    expect(
      runFhirValidation(
        {
          resourceType: 'Patient',
          id: 'patient-1',
          gender: 'jisna',
        },
        { enabled: false, failOnValidationError: true },
      ),
    ).toBeUndefined();
  });
});
