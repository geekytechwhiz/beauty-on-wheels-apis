import { FhirValidationError } from '../validator/fhir.validator';

import { fhirValidationErrorResponse } from './fhir-error-response';

describe('fhirValidationErrorResponse', () => {
  it('returns OperationOutcome with application/fhir+json for FhirValidationError', () => {
    const error = new FhirValidationError(
      [
        {
          severity: 'error',
          code: 'REQUIRED_FIELD_MISSING',
          diagnostics: 'Required field missing: status',
          field: 'status',
        },
      ],
      'Observation',
    );

    const response = fhirValidationErrorResponse(error, {
      correlationId: 'req-123',
      logger: { error: jest.fn() } as never,
    });

    expect(response.statusCode).toBe(422);
    expect(response.headers?.['Content-Type']).toBe('application/fhir+json');

    const body = JSON.parse(response.body);
    expect(body).toEqual({
      resourceType: 'OperationOutcome',
      issue: [
        {
          severity: 'error',
          code: 'required',
          diagnostics: 'Required field missing: status',
          expression: ['Observation.status'],
        },
      ],
    });
  });

  it('maps fhir-validator issue shape to OperationOutcome', () => {
    const response = fhirValidationErrorResponse(
      {
        statusCode: 422,
        code: 'FHIR_VALIDATION_FAILED',
        resourceType: 'Patient',
        issues: [
          {
            validator: 'TerminologyValidator',
            resourceType: 'Patient',
            path: 'gender',
            code: 'INVALID_CODE',
            message: "Invalid code 'jisna' for http://hl7.org/fhir/administrative-gender",
          },
        ],
      },
      { correlationId: 'req-456' },
    );

    const body = JSON.parse(response.body);
    expect(body.resourceType).toBe('OperationOutcome');
    expect(body.issue[0]).toEqual(
      expect.objectContaining({
        severity: 'error',
        diagnostics: expect.stringContaining('jisna'),
        expression: ['Patient.gender'],
        category: 'terminology',
        validator: 'TerminologyValidator',
      }),
    );
  });
});
