import { FhirTransformationService } from '../services/fhir-transformation.service';
import type { LambdaRequest } from '@api-hub/utils';

import {
  isFhirResourceBody,
  isMutatingHttpMethod,
  shouldTransformFhirRequest,
  transformFhirRequest,
} from './transform-fhir-request';

describe('transformFhirRequest', () => {
  const baseReq = {
    event: { httpMethod: 'POST', headers: {} },
    params: {},
    query: {},
    context: {},
    method: 'POST',
  } as unknown as LambdaRequest;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('converts a FHIR Patient body to canonical and stores resource type in context', async () => {
    const transformSpy = jest
      .spyOn(FhirTransformationService.prototype, 'transformFhirToCanonical')
      .mockResolvedValue({
        patientId: 'p1',
        fullName: 'Jane Doe',
      });

    const req = {
      ...baseReq,
      body: {
        resourceType: 'Patient',
        id: 'p1',
        name: [{ text: 'Jane Doe' }],
      },
      context: {},
    } as unknown as LambdaRequest;

    await transformFhirRequest(req, { resourceType: 'Patient' });

    expect(transformSpy).toHaveBeenCalledWith(
      'Patient',
      expect.objectContaining({ resourceType: 'Patient', id: 'p1' }),
      'default',
      { version: undefined },
    );
    expect(req.body).toEqual({ patientId: 'p1', fullName: 'Jane Doe' });
    expect((req.context as { fhirResourceType?: string }).fhirResourceType).toBe(
      'Patient',
    );
  });

  it('skips conversion for GET requests', async () => {
    const transformSpy = jest.spyOn(
      FhirTransformationService.prototype,
      'transformFhirToCanonical',
    );

    const req = {
      ...baseReq,
      event: { ...baseReq.event, httpMethod: 'GET' },
      method: 'GET',
      body: { resourceType: 'Patient', id: 'p1' },
    } as unknown as LambdaRequest;

    await transformFhirRequest(req, { resourceType: 'Patient' });

    expect(transformSpy).not.toHaveBeenCalled();
    expect(req.body).toEqual({ resourceType: 'Patient', id: 'p1' });
  });

  it('shapes create-user Practitioner bodies with userRole from extension', async () => {
    jest
      .spyOn(FhirTransformationService.prototype, 'transformFhirToCanonical')
      .mockResolvedValue({
        userInfo: {
          name: 'river admin',
          contact: {
            phone: '9403505712',
            email: 'Riverdale.Medical.Institute@yopmail.om',
          },
        },
      });

    const req = {
      ...baseReq,
      event: {
        httpMethod: 'POST',
        headers: { 'Content-Type': 'application/fhir+json' },
      },
      body: {
        resourceType: 'Practitioner',
        name: [{ text: 'river admin' }],
        telecom: [
          { system: 'phone', value: '9403505712' },
          { system: 'email', value: 'Riverdale.Medical.Institute@yopmail.om' },
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
      },
      context: {},
    } as unknown as LambdaRequest;

    await transformFhirRequest(req, { inboundProfile: 'createUser' });

    expect(req.body).toEqual(
      expect.objectContaining({
        userType: 'STAFF',
        userRole: ['f76507ca-b5a0-4de2-875c-fed63ccd9107'],
        organizationID: 'mlj7rzzx0b476299',
      }),
    );
  });

  it('shapes assign-doctor canonical payloads without resourceType', async () => {
    const req = {
      ...baseReq,
      event: {
        httpMethod: 'POST',
        headers: { 'Content-Type': 'application/fhir+json' },
      },
      body: {
        organizationId: 'mm3208au877eaa2d',
        sender: { userId: '01KJC8S5RZDG19EGT3XM5Y7XG3' },
        receiver: { userId: '01KSHTY7NCMN9GJZ6P6HYYAV8D' },
      },
      context: {},
    } as unknown as LambdaRequest;

    await transformFhirRequest(req, { inboundProfile: 'assignDoctor' });

    expect(req.body).toEqual({
      organizationId: 'mm3208au877eaa2d',
      sender: { userId: '01KJC8S5RZDG19EGT3XM5Y7XG3' },
      receiver: { userId: '01KSHTY7NCMN9GJZ6P6HYYAV8D' },
      isReferred: undefined,
    });
  });

  it('shapes assign-doctor FHIR Bundle bodies before validation', async () => {
    const req = {
      ...baseReq,
      event: {
        httpMethod: 'POST',
        headers: { 'Content-Type': 'application/fhir+json' },
      },
      body: {
        resourceType: 'Bundle',
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
            },
          },
          {
            resource: {
              resourceType: 'Patient',
              id: '01KSHTY7NCMN9GJZ6P6HYYAV8D',
              name: [{ text: 'Jasmine' }],
            },
          },
        ],
      },
      context: {},
    } as unknown as LambdaRequest;

    await transformFhirRequest(req, { inboundProfile: 'assignDoctor' });

    expect(req.body).toEqual({
      organizationId: 'mm3208au877eaa2d',
      sender: {
        userId: '01KJC8S5RZDG19EGT3XM5Y7XG3',
        name: 'doc cardio',
        email: undefined,
        userType: 'STAFF',
        presenceStatus: undefined,
      },
      receiver: {
        userId: '01KSHTY7NCMN9GJZ6P6HYYAV8D',
        name: 'Jasmine',
        email: undefined,
        profileImage: undefined,
        userType: 'USER',
        presenceStatus: undefined,
      },
      isReferred: undefined,
    });
  });

  it('shapes activate-deactivate FHIR Parameters bodies before validation', async () => {
    const req = {
      ...baseReq,
      event: {
        httpMethod: 'POST',
        headers: { 'Content-Type': 'application/fhir+json' },
      },
      body: {
        resourceType: 'Parameters',
        parameter: [
          { name: 'action', valueCode: 'ACTIVATE' },
          { name: 'patientUserId', valueString: '01KJC8S5RZDG19EGT3XM5Y7XG3' },
          { name: 'organizationID', valueString: 'mm3208au877eaa2d' },
        ],
      },
      context: {},
    } as unknown as LambdaRequest;

    await transformFhirRequest(req, { inboundProfile: 'activateDeactivate' });

    expect(req.body).toEqual({
      action: 'ACTIVATE',
      organizationID: 'mm3208au877eaa2d',
      patientUserId: '01KJC8S5RZDG19EGT3XM5Y7XG3',
    });
  });
});

describe('transformFhirRequest helpers', () => {
  it('detects FHIR resource bodies', () => {
    expect(isFhirResourceBody({ resourceType: 'Patient' })).toBe(true);
    expect(isFhirResourceBody({ ok: true })).toBe(false);
  });

  it('detects mutating HTTP methods', () => {
    expect(
      isMutatingHttpMethod({
        event: { httpMethod: 'POST' },
      } as unknown as LambdaRequest),
    ).toBe(true);
    expect(
      isMutatingHttpMethod({
        event: { httpMethod: 'GET' },
      } as unknown as LambdaRequest),
    ).toBe(false);
  });

  it('always transforms activate-deactivate POST bodies even without FHIR headers', () => {
    const req = {
      event: { httpMethod: 'POST', headers: {} },
      body: {
        resourceType: 'Parameters',
        parameter: [{ name: 'action', valueCode: 'ACTIVATE' }],
      },
    } as unknown as LambdaRequest;

    expect(
      shouldTransformFhirRequest(req, { inboundProfile: 'activateDeactivate' }, false),
    ).toBe(true);
  });

  it('transforms FHIR resource bodies without FHIR negotiation headers', () => {
    const req = {
      event: { httpMethod: 'POST', headers: {} },
      body: { resourceType: 'Patient', id: 'p1' },
    } as unknown as LambdaRequest;

    expect(
      shouldTransformFhirRequest(req, { resourceType: 'Patient' }, false),
    ).toBe(true);
  });
});
