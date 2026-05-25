import objectPath from 'object-path';

import { buildExtensions } from './extension.builder';

describe('extension.builder', () => {
  describe('buildExtensions', () => {
    it('maps valueType to correct FHIR value[x] key', () => {
      const canonical = {
        mrn: 'PI-123',
        isActive: true,
        count: 42,
        birthDate: '1997-07-12',
        statusCode: 'active',
        medicalHistory: { allergies: ['Peanuts'] },
      };

      const extensions = buildExtensions(canonical, [
        { source: 'mrn', url: 'https://example.com/mrn', valueType: 'string' },
        {
          source: 'isActive',
          url: 'https://example.com/active',
          valueType: 'boolean',
        },
        {
          source: 'count',
          url: 'https://example.com/count',
          valueType: 'integer',
        },
        {
          source: 'birthDate',
          url: 'https://example.com/birth',
          valueType: 'date',
        },
        {
          source: 'statusCode',
          url: 'https://example.com/status',
          valueType: 'code',
        },
        {
          source: 'medicalHistory',
          url: 'https://example.com/history',
          valueType: 'json',
        },
      ]);

      expect(extensions).toEqual([
        {
          url: 'https://example.com/mrn',
          valueString: 'PI-123',
        },
        {
          url: 'https://example.com/active',
          valueBoolean: true,
        },
        {
          url: 'https://example.com/count',
          valueInteger: 42,
        },
        {
          url: 'https://example.com/birth',
          valueDate: '1997-07-12',
        },
        {
          url: 'https://example.com/status',
          valueCode: 'active',
        },
        {
          url: 'https://example.com/history',
          valueString: JSON.stringify({ allergies: ['Peanuts'] }),
        },
      ]);
    });

    it('skips null and undefined source values', () => {
      const extensions = buildExtensions(
        { mrn: null, tier: undefined },
        [
          { source: 'mrn', url: 'https://example.com/mrn', valueType: 'string' },
          {
            source: 'tier',
            url: 'https://example.com/tier',
            valueType: 'string',
          },
        ],
      );

      expect(extensions).toEqual([]);
    });

    it('deduplicates by URL keeping the last mapping', () => {
      const extensions = buildExtensions(
        { fieldA: 'first', fieldB: 'second' },
        [
          {
            source: 'fieldA',
            url: 'https://example.com/shared',
            valueType: 'string',
          },
          {
            source: 'fieldB',
            url: 'https://example.com/shared',
            valueType: 'string',
          },
        ],
      );

      expect(extensions).toEqual([
        { url: 'https://example.com/shared', valueString: 'second' },
      ]);
    });
  });
});
