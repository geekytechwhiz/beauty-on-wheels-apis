import { BundleBuilder } from '../builders/BundleBuilder';
import { FhirTransformationService } from '../services/fhir-transformation.service';
import { ResourceDiscoveryService } from '../services/resource-discovery.service';
import { createDefaultResourceMappers } from '../registry/resource-mapper.registry';
import { EXCLUDED_PLATFORM_FIELDS } from '../constants/excluded-fields';

describe('FHIR projection layer', () => {
  const service = new FhirTransformationService();

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
    const discovery = ResourceDiscoveryService.createDefault(service);

    it('auto-detects Patient from patientId', () => {
      const mappers = discovery.discover({ patientId: '01K', mrn: 'PI-123' });
      expect(mappers.map((m) => m.resourceType)).toEqual(['Patient']);
    });

    it('auto-detects Patient and Practitioner from mixed payload', () => {
      const mappers = discovery.discover({
        patientId: '01K',
        mrn: 'PI-123',
        reporterName: 'Dr Smith',
        reporterEmail: 'smith@test.com',
      });

      expect(mappers.map((m) => m.resourceType)).toEqual([
        'Patient',
        'Practitioner',
      ]);
    });

    it('returns no mappers when nothing matches', () => {
      const mappers = discovery.discover({ ok: true });
      expect(mappers).toEqual([]);
    });

    it('honors explicit resource override', () => {
      const mappers = discovery.discover(
        {
          patientId: '01K',
          reporterName: 'Dr Smith',
          reporterEmail: 'smith@test.com',
        },
        ['Patient'],
      );

      expect(mappers.map((m) => m.resourceType)).toEqual(['Patient']);
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

      expect(resources.map((r) => r.resourceType)).toEqual([
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

      expect(resources.map((r) => r.resourceType)).toEqual([
        'Patient',
        'Organization',
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

  describe('createDefaultResourceMappers', () => {
    it('registers all default mappers in stable order', () => {
      const mappers = createDefaultResourceMappers(service);
      expect(mappers.map((m) => m.resourceType)).toEqual([
        'Patient',
        'Practitioner',
        'RelatedPerson',
        'Organization',
      ]);
    });
  });
});
