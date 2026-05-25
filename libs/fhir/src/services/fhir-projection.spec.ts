import { bootstrapFhirLibrary } from '../bootstrap';
import { BundleBuilder } from '../builders/BundleBuilder';
import { EXCLUDED_PLATFORM_FIELDS } from '../constants/excluded-fields';
import { FhirTransformationService } from './fhir-transformation.service';
import { ResourceDiscoveryService } from './resource-discovery.service';

describe('FHIR projection layer', () => {
  beforeAll(() => {
    bootstrapFhirLibrary();
  });

  const service = new FhirTransformationService();
  const discovery = new ResourceDiscoveryService();

  describe('BundleBuilder', () => {
    it('builds a collection bundle from resources', () => {
      const builder = new BundleBuilder();
      const bundle = builder.build([
        { resourceType: 'Patient', id: 'p1' },
        { resourceType: 'Practitioner', id: 'pr1' },
      ]);

      expect(bundle).toEqual({
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          { resource: { resourceType: 'Patient', id: 'p1' } },
          { resource: { resourceType: 'Practitioner', id: 'pr1' } },
        ],
      });
    });
  });

  describe('ResourceDiscoveryService', () => {
    it('falls back to signal detection for Patient from patientId', () => {
      const configs = discovery.discover({ patientId: '01K', mrn: 'PI-123' });
      expect(configs.map((config) => config.resource)).toEqual(['Patient']);
    });

    it('falls back to signal detection for Patient and Practitioner from mixed payload', () => {
      const configs = discovery.discover({
        patientId: '01K',
        mrn: 'PI-123',
        reporterName: 'Dr Smith',
        reporterEmail: 'smith@test.com',
      });

      expect(configs.map((config) => config.resource)).toEqual([
        'Patient',
        'Practitioner',
      ]);
    });

    it('returns no configs when nothing matches', () => {
      const configs = discovery.discover({ ok: true });
      expect(configs).toEqual([]);
    });

    it('uses handler resourceTypes as primary selection', () => {
      const configs = discovery.discover(
        {
          patientId: '01K',
          reporterName: 'Dr Smith',
          reporterEmail: 'smith@test.com',
        },
        ['Patient'],
      );

      expect(configs.map((config) => config.resource)).toEqual(['Patient']);
    });

    it('uses payload resourceType before signal detection', () => {
      const configs = discovery.discover({
        resourceType: 'Patient',
        reporterName: 'Dr Smith',
        reporterEmail: 'smith@test.com',
      });

      expect(configs.map((config) => config.resource)).toEqual(['Patient']);
    });

    it('uses payload resources array before signal detection', () => {
      const configs = discovery.discover({
        patientId: '01K',
        reporterName: 'Dr Smith',
        resources: ['Practitioner'],
      });

      expect(configs.map((config) => config.resource)).toEqual(['Practitioner']);
    });
  });

  describe('FhirTransformationService.transformToProjection', () => {
    it('maps Patient only', async () => {
      const resources = await service.transformToProjection({
        patientId: '01K',
        mrn: 'PI-123',
        lastName: 'Doe',
        isLoggedIn: true,
        roleName: 'PATIENT',
      });

      expect(resources).toHaveLength(1);
      expect(resources[0].resourceType).toBe('Patient');
      expect(resources[0].id).toBe('01K');
      expect(resources[0].isLoggedIn).toBeUndefined();
      expect(resources[0].roleName).toBeUndefined();
      expect(resources[0].extension).toEqual(
        expect.arrayContaining([
          {
            url: 'https://myvirtualrx.com/fhir/custom/mrn',
            valueString: 'PI-123',
          },
        ]),
      );
    });

    it('maps Patient and Practitioner from one object', async () => {
      const resources = await service.transformToProjection({
        patientId: '01K',
        mrn: 'PI-123',
        reporterName: 'Dr Smith',
        reporterEmail: 'smith@test.com',
      });

      expect(resources.map((resource) => resource.resourceType)).toEqual([
        'Patient',
        'Practitioner',
      ]);
    });

    it('maps multiple resource types when organization fields are present', async () => {
      const resources = await service.transformToProjection({
        patientId: '01K',
        organizationId: 'org-1',
        organizationName: 'Acme Health',
      });

      expect(resources.map((resource) => resource.resourceType).sort()).toEqual([
        'Organization',
        'Patient',
      ]);
    });

    it('returns empty array when no resource is detected', async () => {
      const resources = await service.transformToProjection({ ok: true });
      expect(resources).toEqual([]);
    });

    it('maps array input across items', async () => {
      const resources = await service.transformToProjection([
        { patientId: 'p1', mrn: 'MRN-1' },
        { patientId: 'p2', mrn: 'MRN-2' },
      ]);

      expect(resources).toHaveLength(2);
      expect(resources[0].id).toBe('p1');
      expect(resources[1].id).toBe('p2');
    });

    it('unwraps items wrapper for list payloads', async () => {
      const resources = await service.transformToProjection({
        items: [
          { patientId: 'p1', mrn: 'MRN-1' },
          { patientId: 'p2', mrn: 'MRN-2' },
        ],
      });

      expect(resources).toHaveLength(2);
    });

    it('uses explicit resource override even when other signals exist', async () => {
      const resources = await service.transformToProjection(
        {
          patientId: '01K',
          reporterName: 'Dr Smith',
          reporterEmail: 'smith@test.com',
        },
        { resourceTypes: ['Practitioner'] },
      );

      expect(resources).toHaveLength(1);
      expect(resources[0].resourceType).toBe('Practitioner');
    });

    it('never maps excluded platform fields into FHIR output', async () => {
      const resources = await service.transformToProjection({
        patientId: '01K',
        mrn: 'PI-123',
        ...Object.fromEntries(EXCLUDED_PLATFORM_FIELDS.map((field) => [field, 'x'])),
      });

      const patient = resources[0];
      for (const field of EXCLUDED_PLATFORM_FIELDS) {
        expect(patient[field]).toBeUndefined();
      }
    });
  });
});
