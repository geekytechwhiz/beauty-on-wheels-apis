import { mapCode, registerMapping, reverseMapCode, type MappedCoding } from './index';

describe('terminology code-mapping', () => {
  describe('mapCode', () => {
    it('returns undefined when no mapping exists', () => {
      expect(mapCode('unknown', 'http://internal', 'http://loinc.org')).toBeUndefined();
    });

    it('returns undefined when target system does not match', () => {
      registerMapping('http://internal', 'cbc', {
        system: 'http://loinc.org',
        code: '58410-2',
        display: 'CBC',
      });
      expect(mapCode('cbc', 'http://internal', 'http://snomed.info/sct')).toBeUndefined();
    });

    it('returns mapped coding when registered for exact key and target system', () => {
      registerMapping('http://internal.example.com', 'cbc', {
        system: 'http://loinc.org',
        code: '58410-2',
        display: 'CBC',
      });
      const result = mapCode('cbc', 'http://internal.example.com', 'http://loinc.org');
      expect(result).toEqual({
        system: 'http://loinc.org',
        code: '58410-2',
        display: 'CBC',
      });
    });

    it('returns mapped coding with optional display', () => {
      registerMapping('http://sys', 'code1', {
        system: 'http://loinc.org',
        code: '1234-5',
      });
      const result = mapCode('code1', 'http://sys', 'http://loinc.org');
      expect(result).toEqual({ system: 'http://loinc.org', code: '1234-5' });
    });
  });

  describe('registerMapping', () => {
    it('allows registering and then resolving a mapping', () => {
      const target: MappedCoding = {
        system: 'http://loinc.org',
        code: '8867-4',
        display: 'Heart rate',
      };
      registerMapping('http://partner.com', 'hr', target);
      expect(mapCode('hr', 'http://partner.com', 'http://loinc.org')).toEqual(target);
    });

    it('supports reverse lookup from target code to internal code', () => {
      registerMapping('http://partner.com', 'hr', {
        system: 'http://loinc.org',
        code: '8867-4',
      });

      expect(
        reverseMapCode('8867-4', 'http://loinc.org', 'http://partner.com'),
      ).toBe('hr');
    });
  });
});
