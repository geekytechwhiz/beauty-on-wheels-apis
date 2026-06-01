import type { LambdaRequest } from '@api-hub/utils';

import { enrichAssignDoctorFromFhir } from './assign-doctor-fhir.transform';

describe('enrichAssignDoctorFromFhir', () => {
  const baseReq = {
    event: { headers: {} },
    context: {
      userContext: { organizationId: 'org-from-jwt' },
    },
  } as unknown as LambdaRequest;

  it('passes through canonical assign-doctor payloads', () => {
    const result = enrichAssignDoctorFromFhir(baseReq, {
      organizationId: 'mm3208au877eaa2d',
      sender: {
        userId: '01KJC8S5RZDG19EGT3XM5Y7XG3',
        name: 'doc cardio',
        email: 'doc.paper.c@yopmail.com',
        userType: 'STAFF',
        presenceStatus: 'ONLINE',
      },
      receiver: {
        userId: '01KSHTY7NCMN9GJZ6P6HYYAV8D',
        name: 'Jasmine',
        email: 'pat.jasmine.paper@yopmail.com',
        profileImage: '',
        userType: 'MOBILE',
        presenceStatus: 'OFFLINE',
      },
    });

    expect(result).toEqual({
      organizationId: 'mm3208au877eaa2d',
      sender: expect.objectContaining({ userId: '01KJC8S5RZDG19EGT3XM5Y7XG3' }),
      receiver: expect.objectContaining({ userId: '01KSHTY7NCMN9GJZ6P6HYYAV8D' }),
      isReferred: undefined,
    });
  });

  it('maps sender and receiver ids from extensions', () => {
    const result = enrichAssignDoctorFromFhir(baseReq, {
      resourceType: 'Parameters',
      extension: [
        {
          url: 'http://your-domain.com/fhir/StructureDefinition/organization-id',
          valueString: 'mm3208au877eaa2d',
        },
        {
          url: 'http://your-domain.com/fhir/StructureDefinition/sender-id',
          valueString: '01KJC8S5RZDG19EGT3XM5Y7XG3',
        },
        {
          url: 'http://your-domain.com/fhir/StructureDefinition/receiver-id',
          valueString: '01KSHTY7NCMN9GJZ6P6HYYAV8D',
        },
      ],
    });

    expect(result.organizationId).toBe('mm3208au877eaa2d');
    expect(result.sender?.userId).toBe('01KJC8S5RZDG19EGT3XM5Y7XG3');
    expect(result.receiver?.userId).toBe('01KSHTY7NCMN9GJZ6P6HYYAV8D');
  });

  it('maps a FHIR Bundle with Practitioner and Patient entries', () => {
    const result = enrichAssignDoctorFromFhir(baseReq, {
      resourceType: 'Bundle',
      type: 'collection',
      extension: [
        {
          url: 'http://your-domain.com/fhir/StructureDefinition/organization-id',
          valueString: 'mm3208au877eaa2d',
        },
      ],
      entry: [
        {
          resource: {
            resourceType: 'Practitioner',
            id: '01KJC8S5RZDG19EGT3XM5Y7XG3',
            name: [{ text: 'doc cardio' }],
            telecom: [{ system: 'email', value: 'doc.paper.c@yopmail.com' }],
          },
        },
        {
          resource: {
            resourceType: 'Patient',
            id: '01KSHTY7NCMN9GJZ6P6HYYAV8D',
            name: [{ text: 'Jasmine' }],
            telecom: [{ system: 'email', value: 'pat.jasmine.paper@yopmail.com' }],
          },
        },
      ],
    });

    expect(result.organizationId).toBe('mm3208au877eaa2d');
    expect(result.sender).toEqual({
      userId: '01KJC8S5RZDG19EGT3XM5Y7XG3',
      name: 'doc cardio',
      email: 'doc.paper.c@yopmail.com',
      userType: 'STAFF',
      presenceStatus: undefined,
    });
    expect(result.receiver).toEqual({
      userId: '01KSHTY7NCMN9GJZ6P6HYYAV8D',
      name: 'Jasmine',
      email: 'pat.jasmine.paper@yopmail.com',
      profileImage: undefined,
      userType: 'USER',
      presenceStatus: undefined,
    });
  });

  it('maps doctorUserId and patientUserId top-level aliases', () => {
    const result = enrichAssignDoctorFromFhir(baseReq, {
      organizationId: 'mm3208au877eaa2d',
      doctorUserId: '01KJC8S5RZDG19EGT3XM5Y7XG3',
      patientUserId: '01KSHTY7NCMN9GJZ6P6HYYAV8D',
    });

    expect(result.sender?.userId).toBe('01KJC8S5RZDG19EGT3XM5Y7XG3');
    expect(result.receiver?.userId).toBe('01KSHTY7NCMN9GJZ6P6HYYAV8D');
  });

  it('maps FHIR Parameters.parameter parts', () => {
    const result = enrichAssignDoctorFromFhir(baseReq, {
      resourceType: 'Parameters',
      parameter: [
        { name: 'organizationId', valueString: 'mm3208au877eaa2d' },
        { name: 'doctorUserId', valueString: '01KJC8S5RZDG19EGT3XM5Y7XG3' },
        { name: 'patientUserId', valueString: '01KSHTY7NCMN9GJZ6P6HYYAV8D' },
      ],
    });

    expect(result.organizationId).toBe('mm3208au877eaa2d');
    expect(result.sender?.userId).toBe('01KJC8S5RZDG19EGT3XM5Y7XG3');
    expect(result.receiver?.userId).toBe('01KSHTY7NCMN9GJZ6P6HYYAV8D');
  });

  it('maps sender and receiver from FHIR references', () => {
    const result = enrichAssignDoctorFromFhir(baseReq, {
      organizationId: 'mm3208au877eaa2d',
      sender: { reference: 'Practitioner/01KJC8S5RZDG19EGT3XM5Y7XG3' },
      receiver: { reference: 'Patient/01KSHTY7NCMN9GJZ6P6HYYAV8D' },
    });

    expect(result.sender?.userId).toBe('01KJC8S5RZDG19EGT3XM5Y7XG3');
    expect(result.receiver?.userId).toBe('01KSHTY7NCMN9GJZ6P6HYYAV8D');
  });

  it('maps receiver-id from a single Practitioner body', () => {
    const result = enrichAssignDoctorFromFhir(baseReq, {
      resourceType: 'Practitioner',
      id: '01KJC8S5RZDG19EGT3XM5Y7XG3',
      extension: [
        {
          url: 'http://your-domain.com/fhir/StructureDefinition/organization-id',
          valueString: 'mm3208au877eaa2d',
        },
        {
          url: 'http://your-domain.com/fhir/StructureDefinition/receiver-id',
          valueString: '01KSHTY7NCMN9GJZ6P6HYYAV8D',
        },
      ],
    });

    expect(result.sender?.userId).toBe('01KJC8S5RZDG19EGT3XM5Y7XG3');
    expect(result.receiver?.userId).toBe('01KSHTY7NCMN9GJZ6P6HYYAV8D');
  });

  it('maps nested FHIR Patient receiver objects', () => {
    const result = enrichAssignDoctorFromFhir(baseReq, {
      organizationId: 'mm3208au877eaa2d',
      sender: { userId: '01KJC8S5RZDG19EGT3XM5Y7XG3' },
      receiver: {
        resourceType: 'Patient',
        id: '01KSHTY7NCMN9GJZ6P6HYYAV8D',
        name: [{ text: 'Jasmine' }],
      },
    });

    expect(result.receiver?.userId).toBe('01KSHTY7NCMN9GJZ6P6HYYAV8D');
    expect(result.receiver?.name).toBe('Jasmine');
  });
});
