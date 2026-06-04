import { enrichCreateUserCanonical } from './create-user-fhir.transform';

describe('enrichCreateUserCanonical', () => {
  it('maps Practitioner FHIR fields into the create-user contract', () => {
    const fhirResource = {
      resourceType: 'Practitioner',
      name: [{ prefix: ['Mr'], text: 'river admin', given: ['river'], family: 'admin' }],
      telecom: [
        { system: 'phone', value: '9403505712' },
        { system: 'email', value: 'Riverdale.Medical.Institute@yopmail.om' },
      ],
      address: [
        {
          line: ['manimajra'],
          city: 'Bhiwani',
          state: 'Haryana',
          postalCode: '131109',
          country: 'India',
        },
      ],
      photo: [
        {
          url: 'https://d2zvxvbt9m8l3w.cloudfront.net/hospital-images/example.png',
        },
      ],
      extension: [
        {
          url: 'https://myvirtualrx.com/fhir/create-user/userRole',
          valueString: 'f76507ca-b5a0-4de2-875c-fed63ccd9107',
        },
        {
          url: 'https://myvirtualrx.com/fhir/create-user/organizationID',
          valueString: 'mlj7rzzx0b476299',
        },
      ],
    };

    const result = enrichCreateUserCanonical(
      fhirResource,
      {
        userInfo: {
          namePrefix: 'Mr',
          name: 'river admin',
          contact: {
            phone: '9403505712',
            email: 'Riverdale.Medical.Institute@yopmail.om',
          },
        },
      },
      'Practitioner',
    );

    expect(result).toEqual({
      userInfo: {
        namePrefix: 'Mr',
        name: 'river admin',
        profilePic:
          'https://d2zvxvbt9m8l3w.cloudfront.net/hospital-images/example.png',
        contact: {
          phone: '9403505712',
          email: 'Riverdale.Medical.Institute@yopmail.om',
          address: {
            address: 'manimajra',
            city: 'Bhiwani',
            state: 'Haryana',
            postalCode: '131109',
            country: 'India',
          },
        },
      },
      userType: 'STAFF',
      userRole: ['f76507ca-b5a0-4de2-875c-fed63ccd9107'],
      organizationID: 'mlj7rzzx0b476299',
      profilePic:
        'https://d2zvxvbt9m8l3w.cloudfront.net/hospital-images/example.png',
    });
  });

  it('reads userRole from a passthrough field on the FHIR resource', () => {
    const result = enrichCreateUserCanonical(
      {
        resourceType: 'Practitioner',
        userRole: ['role-1'],
        name: [{ text: 'Jane Doe' }],
      },
      { userInfo: { name: 'Jane Doe', contact: { email: 'jane@test.com' } } },
      'Practitioner',
    );

    expect(result.userRole).toEqual(['role-1']);
    expect(result.userType).toBe('STAFF');
  });

  it('reads userRole from Practitioner.identifier', () => {
    const result = enrichCreateUserCanonical(
      {
        resourceType: 'Practitioner',
        identifier: [
          {
            system: 'https://myvirtualrx.com/fhir/user-role',
            value: 'role-from-identifier',
          },
        ],
        name: [{ text: 'Jane Doe' }],
      },
      { userInfo: { name: 'Jane Doe', contact: { email: 'jane@test.com' } } },
      'Practitioner',
    );

    expect(result.userRole).toEqual(['role-from-identifier']);
  });

  it('reads userRole from x-user-role header hints', () => {
    const result = enrichCreateUserCanonical(
      {
        resourceType: 'Practitioner',
        name: [{ text: 'Jane Doe' }],
      },
      { userInfo: { name: 'Jane Doe', contact: { email: 'jane@test.com' } } },
      'Practitioner',
      { headerUserRole: ['role-from-header'] },
    );

    expect(result.userRole).toEqual(['role-from-header']);
  });

  it('matches extension URLs by suffix', () => {
    const result = enrichCreateUserCanonical(
      {
        resourceType: 'Practitioner',
        extension: [
          {
            url: 'https://example.org/fhir/create-user/userRole',
            valueCode: 'role-from-suffix-url',
          },
        ],
        name: [{ text: 'Jane Doe' }],
      },
      { userInfo: { name: 'Jane Doe', contact: { email: 'jane@test.com' } } },
      'Practitioner',
    );

    expect(result.userRole).toEqual(['role-from-suffix-url']);
  });

  it('reads userRole nested under userInfo', () => {
    const result = enrichCreateUserCanonical(
      {
        resourceType: 'Practitioner',
        name: [{ text: 'Jane Doe' }],
        userInfo: { userRole: ['role-nested'] },
      },
      { userInfo: { name: 'Jane Doe', contact: { email: 'jane@test.com' } } },
      'Practitioner',
    );

    expect(result.userRole).toEqual(['role-nested']);
  });

  it('reads userRole from StructureDefinition/user-role extension on Patient', () => {
    const result = enrichCreateUserCanonical(
      {
        resourceType: 'Patient',
        extension: [
          {
            url: 'http://your-domain.com/fhir/StructureDefinition/user-role',
            valueString: 'f76507ca-b5a0-4de2-875c-fed63ccd9107',
          },
        ],
        name: [{ prefix: ['Mr'], text: 'river admin', given: ['river'], family: 'admin' }],
        telecom: [
          { system: 'phone', value: '+919403505712' },
          { system: 'email', value: 'Riverdale.Medical.Institute@yopmail.om' },
        ],
      },
      {
        userInfo: {
          name: 'river admin',
          contact: {
            phone: '+919403505712',
            email: 'Riverdale.Medical.Institute@yopmail.om',
          },
        },
      },
      'Patient',
    );

    expect(result.userRole).toEqual(['f76507ca-b5a0-4de2-875c-fed63ccd9107']);
    expect(result.userType).toBe('USER');
  });

  it('fixes phone mapped onto email when telecom order does not match mapping indices', () => {
    const fhirResource = {
      resourceType: 'Practitioner',
      name: [{ text: 'Jane Doe' }],
      telecom: [
        { system: 'email', value: 'jane@example.com' },
        { system: 'phone', value: '9403505712' },
      ],
      extension: [
        {
          url: 'https://myvirtualrx.com/fhir/create-user/userRole',
          valueString: 'role-uuid',
        },
      ],
    };

    const result = enrichCreateUserCanonical(
      fhirResource,
      {
        userInfo: {
          name: 'Jane Doe',
          contact: {
            phone: 'jane@example.com',
            email: '9403505712',
          },
        },
      },
      'Practitioner',
    );

    expect(result.userInfo.contact).toMatchObject({
      phone: '9403505712',
      email: 'jane@example.com',
    });
    expect(result.userRole).toEqual(['role-uuid']);
  });

  it('reads userRole from valueCoding extension', () => {
    const result = enrichCreateUserCanonical(
      {
        resourceType: 'Practitioner',
        extension: [
          {
            url: 'https://myvirtualrx.com/fhir/create-user/userRole',
            valueCoding: { code: 'role-from-coding' },
          },
        ],
        name: [{ text: 'Jane Doe' }],
        telecom: [{ system: 'email', value: 'jane@test.com' }],
      },
      { userInfo: { name: 'Jane Doe', contact: { email: 'jane@test.com' } } },
      'Practitioner',
    );

    expect(result.userRole).toEqual(['role-from-coding']);
  });

  it('reads organizationID from Patient.managingOrganization', () => {
    const result = enrichCreateUserCanonical(
      {
        resourceType: 'Patient',
        managingOrganization: { reference: 'Organization/org-abc' },
        name: [{ text: 'Patient One' }],
        telecom: [{ system: 'email', value: 'p@test.com' }],
        extension: [
          {
            url: 'https://myvirtualrx.com/fhir/create-user/userRole',
            valueString: 'role-1',
          },
        ],
      },
      {
        organizationID: 'org-abc',
        userInfo: { name: 'Patient One', contact: { email: 'p@test.com' } },
      },
      'Patient',
    );

    expect(result.organizationID).toBe('org-abc');
  });

  it('maps transaction Bundle Patient with email-first telecom and no userRole', () => {
    const fhirPatient = {
      resourceType: 'Patient',
      active: true,
      name: [
        {
          use: 'official',
          prefix: ['Mr'],
          text: 'Patient Jasir Hassan',
          family: 'Hassan',
          given: ['Patient', 'Jasir'],
        },
      ],
      gender: 'male',
      birthDate: '1997-07-12',
      telecom: [
        { system: 'email', value: 'pat.jasir.has@yopmail.com' },
        { system: 'phone', value: '+919995123094' },
      ],
      address: [
        {
          line: ['Kochi'],
          city: 'Cochin',
          state: 'Kerala',
          postalCode: '123456',
          country: 'India',
        },
      ],
      contact: [
        {
          relationship: [{ text: 'father' }],
          name: { text: 'Father Jasir' },
          telecom: [
            { system: 'phone', value: '+919809123456' },
            { system: 'email', value: 'father.jasir.fmq@yopmail.com' },
          ],
        },
      ],
    };

    const result = enrichCreateUserCanonical(
      fhirPatient,
      {
        userInfo: {
          name: 'Patient Jasir Hassan',
          namePrefix: 'Mr',
          contact: {
            phone: 'pat.jasir.has@yopmail.com',
            email: '+919995123094',
          },
        },
      },
      'Patient',
      {},
      {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: [{ resource: fhirPatient }],
      },
    );

    expect(result.userInfo.contact).toEqual({
      phone: '+919995123094',
      email: 'pat.jasir.has@yopmail.com',
      address: {
        address: 'Kochi',
        city: 'Cochin',
        state: 'Kerala',
        postalCode: '123456',
        country: 'India',
      },
    });
    expect(result.userRole).toEqual([]);
    expect(result.userType).toBe('USER');
    expect(result.userInfo.emergencyContact).toEqual({
      relationship: 'father',
      name: 'Father Jasir',
      phone: '+919809123456',
      email: 'father.jasir.fmq@yopmail.com',
    });
    expect(result.userInfo.gender).toBe('male');
    expect(result.userInfo.dateOfBirth).toBe('1997-07-12');
  });
});
