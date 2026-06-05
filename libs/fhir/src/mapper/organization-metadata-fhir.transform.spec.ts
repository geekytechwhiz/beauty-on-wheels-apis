import { transformOrganizationMetadataToFhirBundle } from './organization-metadata-fhir.transform';

describe('transformOrganizationMetadataToFhirBundle', () => {
  it('builds a metadata catalog bundle from GET organization/metadata payload', () => {
    const bundle = transformOrganizationMetadataToFhirBundle({
      items: ['manage_users', 'view_reports'],
      orgTypes: [
        { orgTypeId: 'HOSPITAL', name: 'Hospital' },
        { orgTypeId: 'LAB', name: 'Laboratory' },
      ],
      orgSize: [{ value: 'SMALL', min: 1, max: 50 }],
      scheduleConf: {
        availability: [
          {
            available: true,
            day: 'Monday',
            availableHours: [{ from: '09:00', to: '18:00' }],
          },
        ],
      },
      defaultSetting: {
        notifications: { email: true, sms: false },
      },
      supportedVitals: [
        {
          bloodPressure: {
            code: 'bloodPressure',
            displayName: 'Blood Pressure',
          },
        },
      ],
      supportedRelations: {
        father: { id: 'father', name: 'Father' },
      },
      supportedSpecialty: {
        cardiology: { id: 'cardiology', name: 'Cardiology' },
      },
      orgStatus: ['ACTIVE', 'PENDING'],
    });

    expect(bundle?.id).toBe('bundle-org-metadata');
    expect(bundle?.entry?.length).toBeGreaterThanOrEqual(6);

    const catalog = bundle?.entry?.[0]?.resource;
    expect(catalog).toMatchObject({
      resourceType: 'Organization',
      id: 'org-metadata-catalog',
      name: 'Organization Metadata Catalog',
    });

    const hospital = bundle?.entry?.find(
      (entry) => entry.resource?.id === 'HOSPITAL',
    )?.resource;
    expect(hospital).toMatchObject({
      resourceType: 'Organization',
      id: 'HOSPITAL',
      name: 'Hospital',
      partOf: { reference: 'Organization/org-metadata-catalog' },
    });

    const vital = bundle?.entry?.find(
      (entry) => entry.resource?.resourceType === 'ObservationDefinition',
    )?.resource;
    expect(vital).toMatchObject({
      resourceType: 'ObservationDefinition',
      id: 'blood-pressure',
      code: { text: 'Blood Pressure' },
    });
  });

  it('builds a per-organization metadata bundle for PUT responses', () => {
    const bundle = transformOrganizationMetadataToFhirBundle({
      organizationId: 'org-123',
      metadata: { theme: 'dark' },
      updatedAt: '2026-06-04T00:00:00.000Z',
      version: 2,
    });

    expect(bundle?.id).toBe('bundle-org-123');
    expect(bundle?.entry).toHaveLength(1);
    expect(bundle?.entry?.[0]?.resource).toMatchObject({
      resourceType: 'Organization',
      id: 'org-123',
    });
  });
});
