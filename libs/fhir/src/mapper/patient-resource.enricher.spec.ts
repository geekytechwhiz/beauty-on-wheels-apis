import { enrichPatientResource } from './patient-resource.enricher';

describe('enrichPatientResource contact relationship', () => {
  const mapping = {
    resource: 'Patient',
    version: 'R4',
    profile: 'http://hl7.org/fhir/StructureDefinition/Patient',
    fields: [],
  };

  it('codes family emergency contacts with v2-0131 Next-of-Kin (R4)', () => {
    const resource: Record<string, unknown> = { resourceType: 'Patient', id: 'p1' };

    enrichPatientResource(
      resource,
      {
        emergencyContact: {
          name: 'Father Jasir',
          phone: '9809123456',
          relation: 'father',
        },
      },
      mapping,
    );

    expect(resource.contact).toEqual([
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
  });

  it('defaults to Emergency Contact when relation is unknown', () => {
    const resource: Record<string, unknown> = { resourceType: 'Patient', id: 'p1' };

    enrichPatientResource(
      resource,
      {
        emergencyContact: {
          name: 'Alex',
          phone: '555-0100',
          relation: 'neighbor',
        },
      },
      mapping,
    );

    expect(resource.contact?.[0]).toEqual(
      expect.objectContaining({
        relationship: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/v2-0131',
                code: 'C',
                display: 'Emergency Contact',
              },
            ],
            text: 'neighbor',
          },
        ],
      }),
    );
  });
});
