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
          resource: expect.objectContaining({
            resourceType: 'Patient',
            id: '01K',
            extension: expect.arrayContaining([
              {
                url: 'https://myvirtualrx.com/fhir/custom/mrn',
                valueString: 'PI-123',
              },
            ]),
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
