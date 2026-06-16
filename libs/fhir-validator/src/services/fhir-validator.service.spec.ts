import { getFhirValidator } from '../validators/get-fhir-validator';

describe('FhirValidatorService', () => {
  const validator = getFhirValidator();

  it('rejects invalid administrative-gender codes on Patient resources', () => {
    const result = validator.validate({
      resourceType: 'Patient',
      id: 'patient-1',
      gender: 'jisna',
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_CODE',
          path: 'gender',
        }),
      ]),
    );
  });

  it('accepts valid administrative-gender codes on Patient resources', () => {
    const result = validator.validate({
      resourceType: 'Patient',
      id: 'patient-1',
      gender: 'female',
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('validates nested bundle entry resources', () => {
    const result = validator.validate({
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'patient-1',
            gender: 'jisna',
          },
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          validator: 'TerminologyValidator',
          code: 'INVALID_CODE',
          path: 'gender',
        }),
      ]),
    );
  });

  it('rejects invalid reference format', () => {
    const result = validator.validate({
      resourceType: 'Patient',
      id: 'patient-1',
      managingOrganization: {
        reference: 'Organization',
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_REFERENCE',
          path: 'managingOrganization.reference',
        }),
      ]),
    );
  });
});
