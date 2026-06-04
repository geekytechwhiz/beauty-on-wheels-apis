import { enrichCreateOrganizationCanonical } from './create-organization-fhir.transform';

describe('enrichCreateOrganizationCanonical', () => {
  it('fills organizationType and organizationInfo from FHIR Organization coding', () => {
    const fhirResource = {
      resourceType: 'Organization',
      name: 'papers',
      type: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/organization-type',
              code: 'prov',
              display: 'Healthcare Provider',
            },
          ],
        },
      ],
      telecom: [
        { system: 'phone', value: '+918933434334' },
        { system: 'email', value: 'paper@yopmail.com' },
      ],
      address: [
        {
          line: ['road'],
          city: 'Gho Brahmanan de',
          state: 'Jammu and Kashmir',
          postalCode: '120021',
          country: 'India',
        },
      ],
    };

    const canonical = enrichCreateOrganizationCanonical(fhirResource, {
      organizationInfo: {
        address: {
          city: 'Gho Brahmanan de',
        },
      },
    });

    expect(canonical.name).toBe('papers');
    expect(canonical.organizationType).toBe('HOSPITAL');
    expect(canonical.email).toBe('paper@yopmail.com');
    expect(canonical.organizationInfo).toMatchObject({
      organizationName: 'papers',
      organizationType: 'HOSPITAL',
      emailAddress: 'paper@yopmail.com',
      phoneNumber: '+918933434334',
      address: {
        address: 'road',
        city: 'Gho Brahmanan de',
        state: 'Jammu and Kashmir',
        postalCode: '120021',
        country: 'India',
      },
    });
  });

  it('does not map phone-first telecom.0 onto emailAddress', () => {
    const canonical = enrichCreateOrganizationCanonical(
      {
        resourceType: 'Organization',
        name: 'papers',
        telecom: [
          { system: 'phone', value: '+918933434334' },
          { system: 'email', value: 'paper@yopmail.com' },
        ],
      },
      {
        organizationInfo: {
          emailAddress: '+918933434334',
          phoneNumber: 'paper@yopmail.com',
        },
      },
    );

    expect(canonical.email).toBe('paper@yopmail.com');
    expect(canonical.organizationInfo?.emailAddress).toBe('paper@yopmail.com');
    expect(canonical.organizationInfo?.phoneNumber).toBe('+918933434334');
  });
});
