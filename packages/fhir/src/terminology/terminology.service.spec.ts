import { CODE_SYSTEMS } from '@api-hub/terminology';

import {
  FhirTerminologyService,
  createTerminologyService,
} from './terminology.service';

describe('FhirTerminologyService', () => {
  describe('normalizeCode', () => {
    it('delegates to shared terminology and returns code and display', () => {
      const service = new FhirTerminologyService();

      const result = service.normalizeCode(
        CODE_SYSTEMS.ADMINISTRATIVE_GENDER,
        'Male',
      );

      expect(result).toEqual({
        code: 'male',
        display: 'Male',
      });
    });

    it('passes through unknown codes by default', () => {
      const service = createTerminologyService();

      const result = service.normalizeCode(
        CODE_SYSTEMS.ADMINISTRATIVE_GENDER,
        'unknown-value',
      );

      expect(result.code).toBe('unknown-value');
    });
  });

  describe('reverseNormalizeCode', () => {
    it('reverse maps FHIR codes to canonical display values', () => {
      const service = new FhirTerminologyService();

      expect(
        service.reverseNormalizeCode(
          CODE_SYSTEMS.ADMINISTRATIVE_GENDER,
          'female',
        ),
      ).toBe('Female');

      expect(
        service.reverseNormalizeCode(
          CODE_SYSTEMS.ADMINISTRATIVE_GENDER,
          'male',
        ),
      ).toBe('Male');
    });
  });
});
