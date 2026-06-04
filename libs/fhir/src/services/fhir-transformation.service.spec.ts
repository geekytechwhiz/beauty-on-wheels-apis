import { bootstrapFhirLibrary } from '../bootstrap';
import { GenericMapper } from '../mapper/generic-fhir.mapper';
import { DefaultClientMappingRegistry } from '../registry/client-mapping.registry';
import { MappingRegistry } from '../registry/mapping.registry';
import { MappingResolver } from '../resolver/mapping.resolver';
import { defaultTerminologyService } from '../terminology/terminology.service';
import { FhirTransformationService } from './fhir-transformation.service';
import {
  FhirValidationError,
  FhirValidator,
} from '../validator/fhir.validator';
import {
  asResourceConfig,
  canonicalPatient,
  clientPatientOverrideFixture,
  fhirPatientFromFixture,
  flatCanonicalPatient,
  patientMappingFixture,
} from '../testing/mapping.fixtures';

describe('FhirTransformationService', () => {
  beforeAll(() => {
    bootstrapFhirLibrary();
  });

  function createRegistry() {
    const registry = new MappingRegistry();
    registry.register(asResourceConfig(patientMappingFixture));
    return registry;
  }

  function createClientRegistry(clientId = 'acme') {
    const registry = new DefaultClientMappingRegistry();
    registry.register(clientId, asResourceConfig(clientPatientOverrideFixture));
    return registry;
  }

  describe('transformCanonicalToFhir', () => {
    it('transforms canonical data to a FHIR Patient resource', async () => {
      const service = new FhirTransformationService(
        new MappingResolver(createRegistry()),
      );

      const result = await service.transformCanonicalToFhir(
        'Patient',
        canonicalPatient,
      );

      expect(result.resourceType).toBe('Patient');
      expect(result.id).toBe('org-123');
      expect(result.gender).toBe('female');
      expect(result.managingOrganization.reference).toBe(
        'Organization/org-123',
      );
    });

    it('applies client-specific mapping overrides', async () => {
      const service = new FhirTransformationService(
        new MappingResolver(createRegistry(), createClientRegistry()),
      );

      const result = await service.transformCanonicalToFhir(
        'Patient',
        { externalPatientId: 'ext-999', organizationID: 'ignored' },
        'acme',
      );

      expect(result.id).toBe('ext-999');
    });

    it('supports explicit R4 version selection', async () => {
      const service = new FhirTransformationService(
        new MappingResolver(createRegistry()),
      );

      const result = await service.transformCanonicalToFhir(
        'Patient',
        canonicalPatient,
        undefined,
        { version: 'R4' },
      );

      expect(result.resourceType).toBe('Patient');
    });

    it('throws when mapping is not found for resource/version', async () => {
      const service = new FhirTransformationService(
        new MappingResolver(createRegistry()),
      );

      await expect(
        service.transformCanonicalToFhir('Practitioner', {}, undefined, {
          version: 'R4',
        }),
      ).rejects.toMatchObject({
        statusCode: 500,
        code: 'FHIR_MAPPING_NOT_FOUND',
      });
    });

    it('propagates validation failures from FhirValidator', async () => {
      const validator = {
        validateResource: jest.fn().mockRejectedValue(
          new FhirValidationError(
            [
              {
                severity: 'error',
                code: 'REQUIRED_FIELD_MISSING',
                diagnostics: 'Required field missing: status',
                field: 'status',
              },
            ],
            'Observation',
          ),
        ),
      } as unknown as FhirValidator;

      const service = new FhirTransformationService(
        new MappingResolver(createRegistry()),
        new GenericMapper(),
        defaultTerminologyService,
        validator,
      );

      await expect(
        service.transformCanonicalToFhir('Patient', canonicalPatient),
      ).rejects.toBeInstanceOf(FhirValidationError);
    });

    it('skips validation when validate config is false', async () => {
      const validator = {
        validateResource: jest.fn().mockRejectedValue(
          new FhirValidationError([], 'Patient'),
        ),
      } as unknown as FhirValidator;

      const service = new FhirTransformationService(
        new MappingResolver(createRegistry()),
        new GenericMapper(),
        defaultTerminologyService,
        validator,
      );

      await expect(
        service.transformCanonicalToFhir('Patient', canonicalPatient, undefined, {
          validate: false,
        }),
      ).resolves.toMatchObject({ resourceType: 'Patient' });

      expect(validator.validateResource).not.toHaveBeenCalled();
    });
  });

  describe('transformCanonicalToHybridFhir', () => {
    it('returns hybrid payload preserving canonical fields', async () => {
      const service = new FhirTransformationService();

      const result = await service.transformCanonicalToHybridFhir(
        'Patient',
        flatCanonicalPatient,
      );

      expect(result.resourceType).toBe('Patient');
      expect(result.fullName).toBe('Patient Jasir Hassan');
      expect(result.name).toBeDefined();
      expect(result.identifier).toEqual([
        expect.objectContaining({
          system: 'https://myvirtualrx.com/fhir/mrn',
          value: 'PI-MOOIY7IR307713',
        }),
      ]);
      expect(result.text).toEqual(
        expect.objectContaining({ status: 'generated' }),
      );
    });

    it('skips validation by default for hybrid payloads', async () => {
      const validator = {
        validateResource: jest.fn().mockRejectedValue(
          new FhirValidationError([], 'Patient'),
        ),
      } as unknown as FhirValidator;

      const service = new FhirTransformationService(
        new MappingResolver(createRegistry()),
        new GenericMapper(),
        defaultTerminologyService,
        validator,
      );

      await expect(
        service.transformCanonicalToHybridFhir('Patient', flatCanonicalPatient),
      ).resolves.toMatchObject({ resourceType: 'Patient' });

      expect(validator.validateResource).not.toHaveBeenCalled();
    });

    it('maps nested organizationInfo to FHIR Organization id and name', async () => {
      const service = new FhirTransformationService();

      const result = await service.transformCanonicalToFhir('Organization', {
        accountAlias: 'mm3208au877eaa2d',
        organizationInfo: {
          organizationID: 'mm3208au877eaa2d',
          organizationName: 'papers',
          emailAddress: 'paper@yopmail.com',
          phoneNumber: '8933434334',
          organizationType: 'HOSPITAL',
          address: {
            address: 'road',
            city: 'Gho Brahmanan de',
            state: 'Jammu and Kashmir',
            country: 'India',
            postalCode: '120021',
          },
        },
      });

      expect(result.resourceType).toBe('Organization');
      expect(result.id).toBe('mm3208au877eaa2d');
      expect(result.name).toBe('papers');
      expect(result.telecom).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ system: 'email', value: 'paper@yopmail.com' }),
          expect.objectContaining({ system: 'phone', value: '8933434334' }),
        ]),
      );
      expect(result.address).toEqual([
        expect.objectContaining({
          line: ['road'],
          city: 'Gho Brahmanan de',
          state: 'Jammu and Kashmir',
          country: 'India',
          postalCode: '120021',
        }),
      ]);
    });
  });

  describe('transformFhirToCanonical', () => {
    it('transforms FHIR Patient back to canonical shape', async () => {
      const service = new FhirTransformationService(
        new MappingResolver(createRegistry()),
      );

      const result = await service.transformFhirToCanonical(
        'Patient',
        fhirPatientFromFixture,
      );

      expect(result.organizationID).toBe('org-123');
      expect(result.userInfo.name).toBe('Jane Doe');
      expect(result.userInfo.gender).toBe('Female');
      expect(result.userInfo.contact.email).toBe('jane@example.com');
    });

    it('uses client overrides for reverse mapping', async () => {
      const service = new FhirTransformationService(
        new MappingResolver(createRegistry(), createClientRegistry()),
      );

      const result = await service.transformFhirToCanonical(
        'Patient',
        { id: 'ext-777' },
        'acme',
      );

      expect(result.externalPatientId).toBe('ext-777');
    });
  });
});
