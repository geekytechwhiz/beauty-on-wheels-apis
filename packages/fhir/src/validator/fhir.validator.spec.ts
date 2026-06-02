import {
  FhirValidationError,
  FhirValidator,
} from './fhir.validator';

describe('FhirValidator', () => {
  const validator = new FhirValidator();

  it('accepts a valid Patient resource', async () => {
    await expect(
      validator.validateResource({
        resource: {
          resourceType: 'Patient',
          id: 'patient-1',
        },
        resourceType: 'Patient',
        version: 'R4',
      }),
    ).resolves.toBeUndefined();
  });

  it('throws FhirValidationError when resource is missing', async () => {
    await expect(
      validator.validateResource({
        resource: undefined,
        resourceType: 'Patient',
      }),
    ).rejects.toMatchObject({
      code: 'FHIR_VALIDATION_FAILED',
      statusCode: 422,
      resourceType: 'Patient',
    });
  });

  it('throws FhirValidationError for resource type mismatch', async () => {
    await expect(
      validator.validateResource({
        resource: { resourceType: 'Organization' },
        resourceType: 'Patient',
      }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_RESOURCE_TYPE',
          severity: 'error',
        }),
      ]),
    });
  });

  it('throws FhirValidationError when required Observation fields are missing', async () => {
    try {
      await validator.validateResource({
        resource: {
          resourceType: 'Observation',
          id: 'obs-1',
        },
        resourceType: 'Observation',
        version: 'R4',
      });
      throw new Error('Expected FhirValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(FhirValidationError);
      const validationError = error as FhirValidationError;
      const missingFields = validationError.issues
        .filter((issue) => issue.code === 'REQUIRED_FIELD_MISSING')
        .map((issue) => issue.field);

      expect(missingFields).toEqual(
        expect.arrayContaining(['status', 'code']),
      );
    }
  });
});
