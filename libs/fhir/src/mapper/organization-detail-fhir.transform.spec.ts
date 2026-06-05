import { transformOrganizationDetailToFhirBundle } from './organization-detail-fhir.transform';

describe('transformOrganizationDetailToFhirBundle', () => {
  it('builds a composite organization detail bundle', () => {
    const bundle = transformOrganizationDetailToFhirBundle({
      accountAlias: 'mm3208au877eaa2d',
      adminDetails: {
        adminId: '01KJC8JJJ9YPWGYVBEH9G3BNWJ',
        adminName: 'paper admin',
        namePrefix: 'Mr',
        phoneCode: '+91',
        phoneNumber: '6834994944',
        emailAddress: 'admin.paper@yopmail.com',
        roleName: 'ADMIN',
        adminAddress: {
          country: 'India',
          address: 'gujrat',
          state: 'Delhi',
          city: 'Nangloi Jat',
        },
      },
      organizationInfo: {
        organizationID: 'mm3208au877eaa2d',
        organizationName: 'papers',
        organizationType: 'HOSPITAL',
        emailAddress: 'paper@yopmail.com',
        phoneCode: '+91',
        phoneNumber: '8933434334',
        address: {
          address: 'road',
          city: 'Gho Brahmanan de',
          state: 'Jammu and Kashmir',
          country: 'India',
          postalCode: '120021',
        },
        defaultSetting: {
          chat_session_expire_after: 600000,
          missed_reminder_after: 30,
          notifications: {
            sms: true,
            email: true,
            push: true,
            chat: false,
          },
        },
        scheduleConf: {
          availability: [
            {
              available: true,
              day: 'Monday',
              availableHours: [{ from: '09:00', to: '18:00' }],
            },
          ],
        },
      },
      linkedOrganizations: [
        {
          organizationId: 'mlulqcvy747ae509',
          name: 'earth',
          organizationType: 'LAB',
        },
      ],
      supportedVitals: [
        {
          bloodGlucose: {
            code: 'bloodGlucose',
            displayName: 'Blood Glucose',
          },
        },
        {
          bloodPressure: {
            code: 'bloodPressure',
            displayName: 'Blood Pressure',
          },
        },
      ],
    });

    expect(bundle?.id).toBe('bundle-mm3208au877eaa2d');
    expect(bundle?.entry).toHaveLength(7);

    const org = bundle?.entry[0].resource;
    expect(bundle?.entry[0].fullUrl).toBe('Organization/mm3208au877eaa2d');
    expect(org).toMatchObject({
      resourceType: 'Organization',
      id: 'mm3208au877eaa2d',
      name: 'papers',
      telecom: [
        { system: 'phone', value: '+918933434334' },
        { system: 'email', value: 'paper@yopmail.com' },
      ],
    });
    expect(org?.type).toEqual([
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/organization-type',
            code: 'prov',
            display: 'Healthcare Provider',
          },
        ],
      },
    ]);

    expect(bundle?.entry[1].resource.resourceType).toBe('Practitioner');
    expect(bundle?.entry[2].resource).toMatchObject({
      resourceType: 'PractitionerRole',
      id: 'admin-role',
      practitioner: { reference: 'Practitioner/01KJC8JJJ9YPWGYVBEH9G3BNWJ' },
      organization: { reference: 'Organization/mm3208au877eaa2d' },
      code: [{ text: 'ADMIN' }],
    });

    expect(bundle?.entry[3].resource).toMatchObject({
      resourceType: 'Organization',
      id: 'mlulqcvy747ae509',
      name: 'earth',
      partOf: { reference: 'Organization/mm3208au877eaa2d' },
    });

    expect(bundle?.entry[4].resource.resourceType).toBe('Schedule');
    expect(bundle?.entry[5].resource).toMatchObject({
      resourceType: 'ObservationDefinition',
      id: 'blood-glucose',
      code: { text: 'Blood Glucose' },
    });
    expect(bundle?.entry[6].resource).toMatchObject({
      resourceType: 'ObservationDefinition',
      id: 'blood-pressure',
    });
  });
});
