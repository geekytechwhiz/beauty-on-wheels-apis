import { CODE_SYSTEMS } from './code-systems';
import {
  defaultTerminologyService,
  SharedTerminologyService,
} from './terminology.service';
import { registerMapping, reverseMapCode } from './code-mapping';

describe('SharedTerminologyService', () => {
  describe('administrative gender normalization', () => {
    it('normalizes canonical gender values to FHIR codes', () => {
      expect(
        defaultTerminologyService.normalizeCode(
          CODE_SYSTEMS.ADMINISTRATIVE_GENDER,
          'Male',
        ),
      ).toEqual({
        code: 'male',
        display: 'Male',
        known: true,
      });

      expect(
        defaultTerminologyService.normalizeCode(
          CODE_SYSTEMS.ADMINISTRATIVE_GENDER,
          'Female',
        ),
      ).toEqual({
        code: 'female',
        display: 'Female',
        known: true,
      });
    });

    it('reverse normalizes FHIR gender codes to canonical display values', () => {
      expect(
        defaultTerminologyService.reverseNormalizeCode(
          CODE_SYSTEMS.ADMINISTRATIVE_GENDER,
          'female',
        ),
      ).toBe('Female');

      expect(
        defaultTerminologyService.reverseNormalizeCode(
          CODE_SYSTEMS.ADMINISTRATIVE_GENDER,
          'male',
        ),
      ).toBe('Male');
    });
  });

  describe('standard code systems', () => {
    it('accepts valid LOINC codes', () => {
      expect(
        defaultTerminologyService.normalizeCode(
          CODE_SYSTEMS.LOINC,
          '8867-4',
        ),
      ).toEqual({
        code: '8867-4',
        known: true,
      });
    });

    it('accepts valid SNOMED codes', () => {
      expect(
        defaultTerminologyService.normalizeCode(
          CODE_SYSTEMS.SNOMED,
          '386725007',
        ),
      ).toEqual({
        code: '386725007',
        known: true,
      });
    });

    it('accepts valid ICD-10 codes', () => {
      expect(
        defaultTerminologyService.normalizeCode(
          CODE_SYSTEMS.ICD10,
          'E11.9',
        ),
      ).toEqual({
        code: 'E11.9',
        known: true,
      });
    });
  });

  describe('unknown code validation mode', () => {
    it('passes unknown codes through by default', () => {
      expect(
        defaultTerminologyService.normalizeCode(
          CODE_SYSTEMS.LOINC,
          'not-a-loinc-code',
        ),
      ).toEqual({
        code: 'not-a-loinc-code',
        known: false,
      });
    });

    it('rejects unknown codes when mode is reject', () => {
      const service = new SharedTerminologyService(undefined, {
        unknownCodeMode: 'reject',
      });

      expect(() =>
        service.normalizeCode(CODE_SYSTEMS.LOINC, 'not-a-loinc-code'),
      ).toThrow('Unknown code "not-a-loinc-code"');
    });
  });

  describe('reverse code mapping', () => {
    it('maps target codes back to internal source codes', () => {
      registerMapping('http://internal.example.com', 'cbc', {
        system: CODE_SYSTEMS.LOINC,
        code: '58410-2',
        display: 'CBC',
      });

      expect(
        reverseMapCode('58410-2', CODE_SYSTEMS.LOINC, 'http://internal.example.com'),
      ).toBe('cbc');

      expect(
        defaultTerminologyService.reverseNormalizeCode(
          CODE_SYSTEMS.LOINC,
          '58410-2',
          { targetSourceSystem: 'http://internal.example.com' },
        ),
      ).toBe('cbc');
    });
  });
});
