import { CODE_SYSTEMS } from '@api-hub/terminology';

import { GenericMapper } from './generic-fhir.mapper';
import type { ResourceMappingConfig } from '../registry/mapping.registry';
import {
  canonicalPatient,
  patientMappingFixture,
  flatCanonicalPatient,
  patientR4MappingFixture,
} from '../testing/mapping.fixtures';

describe('GenericMapper', () => {
  describe('map (canonical → FHIR)', () => {
    it('maps nested canonical fields to FHIR resource paths', () => {
      const mapper = new GenericMapper();

      const result = mapper.map(canonicalPatient, patientMappingFixture);

      expect(result).toEqual({
        resourceType: 'Patient',
        id: 'org-123',
        name: [{ prefix: ['Dr'], text: 'Jane Doe' }],
        telecom: [
          { system: 'phone', value: '555-0100' },
          { system: 'email', value: 'jane@example.com' },
        ],
        gender: 'female',
        birthDate: '1990-01-15',
        managingOrganization: { reference: 'Organization/org-123' },
        meta: {
          profile: ['http://hl7.org/fhir/StructureDefinition/Patient'],
        },
        text: {
          status: 'generated',
          div: '<div xmlns="http://www.w3.org/1999/xhtml"><p>Jane Doe</p></div>',
        },
      });
    });

    it('applies defaultValue literals when source is empty', () => {
      const mapper = new GenericMapper();
      const mapping: ResourceMappingConfig = {
        resource: 'Patient',
        version: 'R4',
        fields: [
          {
            source: '',
            target: 'telecom.0.system',
            fieldType: 'literal',
            defaultValue: 'phone',
          },
        ],
      };

      const result = mapper.map({}, mapping);

      expect(result).toEqual({
        resourceType: 'Patient',
        telecom: [{ system: 'phone' }],
        text: {
          status: 'generated',
          div: '<div xmlns="http://www.w3.org/1999/xhtml"><p>Patient</p></div>',
        },
      });
    });

    it('normalizes terminology codes via TerminologyService', () => {
      const normalizeCode = jest.fn().mockReturnValue({
        code: 'male',
        display: 'Male',
      });
      const mapper = new GenericMapper({
        normalizeCode,
        reverseNormalizeCode: jest.fn(),
      });

      const mapping: ResourceMappingConfig = {
        resource: 'Patient',
        version: 'R4',
        fields: [
          {
            source: 'gender',
            target: 'gender',
            fieldType: 'code',
            system: CODE_SYSTEMS.ADMINISTRATIVE_GENDER,
          },
        ],
      };

      mapper.map({ gender: 'Male' }, mapping);

      expect(normalizeCode).toHaveBeenCalledWith(
        CODE_SYSTEMS.ADMINISTRATIVE_GENDER,
        'Male',
      );
    });

    it('applies name transforms', () => {
      const mapper = new GenericMapper();
      const mapping: ResourceMappingConfig = {
        resource: 'Patient',
        version: 'R4',
        fields: [
          {
            source: 'fullName',
            target: 'name.0.given.0',
            fieldType: 'string',
            transform: 'firstName',
          },
          {
            source: 'fullName',
            target: 'name.0.family',
            fieldType: 'string',
            transform: 'lastName',
          },
        ],
      };

      const result = mapper.map({ fullName: 'Jane Marie Doe' }, mapping);

      expect(result.name).toEqual([{ given: ['Jane'], family: 'Marie Doe' }]);
    });

    it('skips null and undefined canonical values', () => {
      const mapper = new GenericMapper();
      const mapping: ResourceMappingConfig = {
        resource: 'Patient',
        version: 'R4',
        fields: [
          {
            source: 'missing',
            target: 'id',
            fieldType: 'string',
          },
        ],
      };

      const result = mapper.map({ missing: null }, mapping);

      expect(result).toEqual({
        resourceType: 'Patient',
        text: {
          status: 'generated',
          div: '<div xmlns="http://www.w3.org/1999/xhtml"><p>Patient</p></div>',
        },
      });
      expect(result.id).toBeUndefined();
    });

    it('normalizes DD-MM-YYYY dates via dateOfBirth transform', () => {
      const mapper = new GenericMapper();
      const mapping: ResourceMappingConfig = {
        resource: 'Patient',
        version: 'R4',
        fields: [
          {
            source: 'dateOfBirth',
            target: 'birthDate',
            fieldType: 'date',
            transform: 'dateOfBirth',
          },
        ],
      };

      const result = mapper.map({ dateOfBirth: '12-07-1997' }, mapping);

      expect(result.birthDate).toBe('1997-07-12');
    });
  });

  describe('mapStrict (canonical → strict FHIR)', () => {
    it('maps only FHIR fields without canonical passthrough', () => {
      const mapper = new GenericMapper();

      const result = mapper.mapStrict(flatCanonicalPatient, patientR4MappingFixture);

      expect(result.resourceType).toBe('Patient');
      expect(result.id).toBe('01KQMPG288ANNZ9FAMMC1WZEH3');
      expect(result.isLoggedIn).toBeUndefined();
      expect(result.roleName).toBeUndefined();
      expect(result.fullName).toBeUndefined();
      expect(result.extension).toBeUndefined();
      expect(result.identifier).toEqual([
        {
          type: {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
                code: 'MR',
              },
            ],
          },
          system: 'https://myvirtualrx.com/fhir/mrn',
          value: 'PI-MOOIY7IR307713',
        },
      ]);
      expect(result.contact).toEqual([
        {
          relationship: [
            {
              coding: [
                {
                  system: 'http://terminology.hl7.org/CodeSystem/v2-0131',
                  code: 'N',
                  display: 'Next-of-Kin',
                },
              ],
              text: 'father',
            },
          ],
          name: { text: 'Father Jasir' },
          telecom: [{ system: 'phone', value: '9809123456' }],
        },
      ]);
      expect(result.text).toEqual(
        expect.objectContaining({
          status: 'generated',
          div: expect.stringContaining('Patient Jasir Hassan'),
        }),
      );
      expect(result.meta).toEqual({
        profile: ['http://hl7.org/fhir/StructureDefinition/Patient'],
      });
    });
  });

  describe('mapHybrid (canonical → hybrid FHIR-compatible)', () => {
    it('preserves all canonical fields while adding FHIR paths', () => {
      const mapper = new GenericMapper();

      const result = mapper.mapHybrid(
        flatCanonicalPatient,
        patientR4MappingFixture,
      );

      expect(result.resourceType).toBe('Patient');
      expect(result.id).toBe('01KQMPG288ANNZ9FAMMC1WZEH3');
      expect(result.fullName).toBe('Patient Jasir Hassan');
      expect(result.phoneNumber).toBe('9995123094');
      expect(result.isLoggedIn).toBe(false);
      expect(result.roleName).toBe('PATIENT');
      expect(result.pk).toBe('ORG#mm3208au877eaa2d');
      expect(result.name).toEqual([
        {
          prefix: ['Mr'],
          text: 'Patient Jasir Hassan',
          given: ['Patient'],
          family: 'Jasir Hassan',
        },
      ]);
      expect(result.telecom).toEqual([
        { system: 'phone', value: '9995123094' },
        { system: 'email', value: 'pat.jasir.has@yopmail.com' },
      ]);
      expect(result.gender).toBe('male');
      expect(result.birthDate).toBe('1997-07-12');
      expect(result.managingOrganization).toEqual({
        reference: 'Organization/mm3208au877eaa2d',
      });
    });

    it('builds standard FHIR patient details without removing source fields', () => {
      const mapper = new GenericMapper();

      const result = mapper.mapHybrid(
        flatCanonicalPatient,
        patientR4MappingFixture,
      );

      expect(result.mrn).toBe('PI-MOOIY7IR307713');
      expect(result.medicalHistory).toEqual(flatCanonicalPatient.medicalHistory);
      expect(result.identifier).toEqual([
        {
          type: {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
                code: 'MR',
              },
            ],
          },
          system: 'https://myvirtualrx.com/fhir/mrn',
          value: 'PI-MOOIY7IR307713',
        },
      ]);
      expect(result.contact).toEqual([
        {
          relationship: [
            {
              coding: [
                {
                  system: 'http://terminology.hl7.org/CodeSystem/v2-0131',
                  code: 'N',
                  display: 'Next-of-Kin',
                },
              ],
              text: 'father',
            },
          ],
          name: { text: 'Father Jasir' },
          telecom: [{ system: 'phone', value: '9809123456' }],
        },
      ]);
      expect(result.text?.div).toContain('Food Allergy');
      expect(result.extension).toBeUndefined();
    });

    it('preserves nested canonical fields for userInfo-based payloads', () => {
      const mapper = new GenericMapper();

      const result = mapper.mapHybrid(canonicalPatient, patientMappingFixture);

      expect(result.organizationID).toBe('org-123');
      expect(result.userInfo).toEqual(canonicalPatient.userInfo);
      expect(result.resourceType).toBe('Patient');
      expect(result.name).toEqual([{ prefix: ['Dr'], text: 'Jane Doe' }]);
    });
  });

  describe('reverseMap (FHIR → canonical)', () => {
    it('maps FHIR resource paths back to canonical fields', () => {
      const mapper = new GenericMapper();
      const fhirResource = {
        resourceType: 'Patient',
        id: 'org-123',
        name: [{ prefix: ['Dr'], text: 'Jane Doe' }],
        telecom: [
          { system: 'phone', value: '555-0100' },
          { system: 'email', value: 'jane@example.com' },
        ],
        gender: 'female',
        birthDate: '1990-01-15',
        managingOrganization: { reference: 'Organization/org-123' },
      };

      const result = mapper.reverseMap(fhirResource, patientMappingFixture);

      expect(result.organizationID).toBe('org-123');
      expect(result.userInfo.name).toBe('Jane Doe');
      expect(result.userInfo.namePrefix).toBe('Dr');
      expect(result.userInfo.contact.phone).toBe('555-0100');
      expect(result.userInfo.contact.email).toBe('jane@example.com');
      expect(result.userInfo.dateOfBirth).toBe('1990-01-15');
    });

    it('strips reference prefixes for reference field types', () => {
      const mapper = new GenericMapper();
      const mapping: ResourceMappingConfig = {
        resource: 'Patient',
        version: 'R4',
        fields: [
          {
            source: 'organizationID',
            target: 'managingOrganization.reference',
            fieldType: 'reference',
          },
        ],
      };

      const result = mapper.reverseMap(
        { managingOrganization: { reference: 'Organization/org-456' } },
        mapping,
      );

      expect(result.organizationID).toBe('org-456');
    });

    it('reverse-normalizes terminology codes', () => {
      const reverseNormalizeCode = jest.fn().mockReturnValue('Female');
      const mapper = new GenericMapper({
        normalizeCode: jest.fn().mockReturnValue({ code: 'female' }),
        reverseNormalizeCode,
      });

      const mapping: ResourceMappingConfig = {
        resource: 'Patient',
        version: 'R4',
        fields: [
          {
            source: 'userInfo.gender',
            target: 'gender',
            fieldType: 'code',
            system: CODE_SYSTEMS.ADMINISTRATIVE_GENDER,
          },
        ],
      };

      mapper.reverseMap({ gender: 'female' }, mapping);

      expect(reverseNormalizeCode).toHaveBeenCalledWith(
        CODE_SYSTEMS.ADMINISTRATIVE_GENDER,
        'female',
      );
    });
  });
});
