import type { LambdaRequest } from '@api-hub/utils';

import { FhirTransformationService } from '@api-hub/fhir';

import {
  isFhirEnabled,
  transformToFhirResponse,
} from './transform-to-fhir-response';

describe('transformToFhirResponse', () => {
  const baseReq = {
    event: { headers: {} },
    params: {},
    context: {},
  } as unknown as LambdaRequest;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isFhirEnabled', () => {
    it('returns true when enabled is true', () => {
      expect(isFhirEnabled({ enabled: true })).toBe(true);
    });

    it('returns true when resourceType, resource, or resources are set', () => {
      expect(isFhirEnabled({ resourceType: 'Patient' })).toBe(true);
      expect(isFhirEnabled({ resource: 'Patient' })).toBe(true);
      expect(isFhirEnabled({ resources: ['Patient'] })).toBe(true);
    });

    it('returns false when fhir options are absent', () => {
      expect(isFhirEnabled(undefined)).toBe(false);
      expect(isFhirEnabled({})).toBe(false);
    });

    it('returns true when inferResourceType or resourceTypeFromContext is set', () => {
      expect(
        isFhirEnabled({ inferResourceType: () => 'Patient' }),
      ).toBe(true);
      expect(isFhirEnabled({ resourceTypeFromContext: true })).toBe(true);
    });
  });

  it('returns a collection bundle with strict FHIR resources', async () => {
    const response = await transformToFhirResponse(
      {
        patientId: '01K',
        mrn: 'PI-123',
        lastName: 'Doe',
        isLoggedIn: true,
        roleName: 'PATIENT',
      },
      { resourceType: 'Patient' },
      baseReq,
    );

    expect(response).toEqual({
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          fullUrl: 'https://myvirtualrx.com/fhir/Patient/01K',
          resource: expect.objectContaining({
            resourceType: 'Patient',
            id: '01K',
            identifier: [
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
                value: 'PI-123',
              },
            ],
            text: expect.objectContaining({ status: 'generated' }),
          }),
        },
      ],
    });

    expect(response?.entry[0].resource.isLoggedIn).toBeUndefined();
    expect(response?.entry[0].resource.roleName).toBeUndefined();
  });

  it('auto-detects Patient and Practitioner when enabled without explicit resource', async () => {
    const response = await transformToFhirResponse(
      {
        patientId: '01K',
        mrn: 'PI-123',
        reporterName: 'Dr Smith',
        reporterEmail: 'smith@test.com',
      },
      { enabled: true },
      baseReq,
    );

    expect(response?.entry.map((e) => e.resource.resourceType)).toEqual([
      'Patient',
      'Practitioner',
    ]);
  });

  it('returns undefined when no resources are detected', async () => {
    const response = await transformToFhirResponse(
      { ok: true },
      { enabled: true },
      baseReq,
    );

    expect(response).toBeUndefined();
  });

  it('aggregates resources from array handler results', async () => {
    const response = await transformToFhirResponse(
      [
        { patientId: 'p1', mrn: 'MRN-1' },
        { patientId: 'p2', mrn: 'MRN-2' },
      ],
      { resourceType: 'Patient' },
      baseReq,
    );

    expect(response?.resourceType).toBe('Bundle');
    expect(response?.type).toBe('collection');
    expect(response?.entry).toHaveLength(2);
    expect(response?.entry[0].resource.id).toBe('p1');
    expect(response?.entry[1].resource.id).toBe('p2');
  });

  it('maps staff user profile fields to a full Practitioner resource', async () => {
    const response = await transformToFhirResponse(
      {
        userID: '01KJC8S5RZDG19EGT3XM5Y7XG3',
        firstName: 'doc',
        lastName: 'cardio',
        namePrefix: 'Dr',
        phoneNumber: '+917892323298',
        emailAddress: 'doc.paper.c@yopmail.com',
        gender: 'male',
        dateOfBirth: '2004-02-04',
        isActive: true,
        userType: 'STAFF',
      },
      {
        inferResourceType: (payload) =>
          String((payload as { userType?: string }).userType ?? '').toUpperCase() ===
          'STAFF'
            ? 'Practitioner'
            : 'Patient',
      },
      baseReq,
    );

    expect(response?.entry[0].resource).toEqual(
      expect.objectContaining({
        resourceType: 'Practitioner',
        id: '01KJC8S5RZDG19EGT3XM5Y7XG3',
        active: true,
        gender: 'male',
        birthDate: '2004-02-04',
        name: [
          {
            prefix: ['Dr'],
            given: ['doc'],
            family: 'cardio',
          },
        ],
        telecom: [
          { system: 'phone', value: '+917892323298' },
          { system: 'email', value: 'doc.paper.c@yopmail.com' },
        ],
        identifier: [
          {
            system: 'urn:myvitalrx:practitioner-id',
            value: '01KJC8S5RZDG19EGT3XM5Y7XG3',
          },
        ],
      }),
    );
  });

  it('maps Patient vs Practitioner via inferResourceType', async () => {
    const inferResourceType = (payload: unknown): string | undefined => {
      const roleName = String(
        (payload as { roleName?: string })?.roleName ?? '',
      ).toUpperCase();
      return roleName === 'DOCTOR' ? 'Practitioner' : 'Patient';
    };

    const patientResponse = await transformToFhirResponse(
      { userID: 'u1', roleName: 'PATIENT', mrn: 'MRN-1' },
      { inferResourceType },
      baseReq,
    );
    expect(patientResponse?.entry[0].resource.resourceType).toBe('Patient');

    const practitionerResponse = await transformToFhirResponse(
      { userID: 'u2', roleName: 'DOCTOR', mrn: 'MRN-2' },
      { inferResourceType },
      baseReq,
    );
    expect(practitionerResponse?.entry[0].resource.resourceType).toBe(
      'Practitioner',
    );
  });

  it('passes client id from request context to transformation', async () => {
    const transformSpy = jest.spyOn(
      FhirTransformationService.prototype,
      'transformToProjection',
    );

    const req = {
      ...baseReq,
      context: { clientId: 'acme' },
    } as unknown as LambdaRequest;

    await transformToFhirResponse(
      { patientId: 'p1', mrn: 'MRN-1' },
      { resourceType: 'Patient' },
      req,
    );

    expect(transformSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ clientId: 'acme', resourceTypes: ['Patient'] }),
    );
  });
});
