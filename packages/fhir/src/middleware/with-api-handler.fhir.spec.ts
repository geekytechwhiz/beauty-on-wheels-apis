import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

import { FhirTransformationService, FhirValidationError } from '@api-hub/fhir';

jest.mock('@aws-lambda-powertools/tracer', () => ({
  Tracer: jest.fn().mockImplementation(() => ({
    captureMethod: () => jest.fn(),
    provider: { captureAsyncFunc: (_: string, fn: () => unknown) => fn() },
    isTracingEnabled: () => false,
    getSegment: () => undefined,
    setSegment: jest.fn(),
    annotateColdStart: jest.fn(),
    addServiceNameAnnotation: jest.fn(),
    putAnnotation: jest.fn(),
    putMetadata: jest.fn(),
    addResponseAsMetadata: jest.fn(),
    addErrorAsMetadata: jest.fn(),
  })),
}));

jest.mock('@api-hub/observability', () => {
  const actual = jest.requireActual<typeof import('@api-hub/observability')>(
    '@api-hub/observability',
  );

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  };

  return {
    ...actual,
    createLogger: () => mockLogger,
    createChildLogger: () => mockLogger,
    extractCorrelationId: () => 'corr-test',
    extractAwsRequestId: () => 'aws-req-test',
    logHttpRequest: jest.fn(),
    publishMiddlewarePipelineMetrics: jest.fn(),
    getConfig: () => ({
      serviceName: 'api-service',
      logLevel: 'info',
      metricsNamespace: 'test',
    }),
  };
});

import { withApiHandler } from '@api-hub/middleware';

function parseBody(response: { body: string }) {
  return JSON.parse(response.body);
}

describe('withApiHandler FHIR integration (fhir-peer)', () => {
  const context = { awsRequestId: 'aws-req-test' } as Context;

  const fhirEvent = {
    httpMethod: 'GET',
    path: '/fhir/Patient',
    headers: {
      Accept: 'application/fhir+json',
    },
    body: null,
    pathParameters: null,
    queryStringParameters: null,
  } as unknown as APIGatewayProxyEvent;

  const canonicalEvent = {
    httpMethod: 'GET',
    path: '/alerts/a1',
    headers: {},
    body: null,
    pathParameters: null,
    queryStringParameters: null,
  } as unknown as APIGatewayProxyEvent;

  describe('without FHIR negotiation', () => {
    it('returns standard success response when fhir option is omitted', async () => {
      const handler = withApiHandler({ operation: 'getPatient' }, async () => ({
        ok: true,
      }));

      const response = await handler(fhirEvent, context);
      const body = parseBody(response);

      expect(response.statusCode).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ ok: true });
      expect(body.fhir).toBeUndefined();
    });

    it('returns canonical JSON when fhir is enabled but the caller did not request FHIR', async () => {
      const canonical = {
        userID: 'user-123',
        organizationID: 'org-123',
        firstName: 'Jane',
        lastName: 'Doe',
        emailAddress: 'jane@example.com',
        phoneNumber: '555-0100',
        isLoggedIn: true,
      };

      const handler = withApiHandler(
        { operation: 'getPatient', fhir: { resourceType: 'Patient' } },
        async () => canonical,
      );

      const response = await handler(canonicalEvent, context);
      const body = parseBody(response);

      expect(response.statusCode).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toEqual(canonical);
      expect(body.fhir).toBeUndefined();
      expect(body.resourceType).toBeUndefined();
    });

    it('does not add fhir sibling for inbound-only profiles without negotiation headers', async () => {
      let receivedBody: unknown;
      const handler = withApiHandler(
        {
          operation: 'user.activateDeactivate',
          fhir: { inboundProfile: 'activateDeactivate' },
        },
        async (req) => {
          receivedBody = req.body;
          return { message: 'User activated' };
        },
      );

      const response = await handler(
        {
          httpMethod: 'POST',
          path: '/user/activate-deactivate',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resourceType: 'Parameters',
            parameter: [
              { name: 'action', valueCode: 'ACTIVATE' },
              { name: 'patientUserId', valueString: '01KJC8S5RZDG19EGT3XM5Y7XG3' },
              { name: 'organizationID', valueString: 'mm3208au877eaa2d' },
            ],
          }),
          pathParameters: null,
          queryStringParameters: null,
        } as unknown as APIGatewayProxyEvent,
        context,
      );

      const body = parseBody(response);

      expect(receivedBody).toEqual({
        action: 'ACTIVATE',
        organizationID: 'mm3208au877eaa2d',
        patientUserId: '01KJC8S5RZDG19EGT3XM5Y7XG3',
      });
      expect(body.data).toEqual({ message: 'User activated' });
      expect(body.fhir).toBeUndefined();
    });
  });

  describe('with FHIR negotiation (data + fhir sibling envelope)', () => {
    it('returns canonical data with a sibling fhir Bundle on GET', async () => {
      const canonical = {
        userID: 'user-123',
        organizationID: 'org-123',
        firstName: 'Jane',
        lastName: 'Doe',
        emailAddress: 'jane@example.com',
        phoneNumber: '555-0100',
        isLoggedIn: true,
      };

      const handler = withApiHandler(
        { operation: 'getPatient', fhir: { resourceType: 'Patient' } },
        async () => canonical,
      );

      const response = await handler(fhirEvent, context);
      const body = parseBody(response);

      expect(response.statusCode).toBe(200);
      expect(response.headers?.['Content-Type']).toBe('application/json');
      expect(body.success).toBe(true);
      expect(body.data).toEqual(canonical);
      expect(body.fhir.resourceType).toBe('Bundle');
      expect(body.fhir.type).toBe('collection');
      expect(body.fhir.entry[0].resource.resourceType).toBe('Patient');
      expect(body.fhir.entry[0].resource.id).toBe('user-123');
      expect(body.fhir.entry[0].resource.isLoggedIn).toBeUndefined();
      expect(body.fhir.entry[0].resource.firstName).toBeUndefined();
      expect(body.fhir.entry[0].resource.name).toBeDefined();
      expect(body.fhir.entry[0].resource.telecom).toBeDefined();
    });

    it('maps flat patient payload to a FHIR Bundle sibling for FHIR GET callers', async () => {
      const canonical = {
        patientId: '01KQMPG288ANNZ9FAMMC1WZEH3',
        lastName: 'Jasir Hassan',
        namePrefix: 'Mr',
        phoneNumber: '9995123094',
        mrn: 'PI-MOOIY7IR307713',
        isLoggedIn: false,
        roleName: 'PATIENT',
      };

      const handler = withApiHandler(
        { operation: 'alert.get', fhir: { resourceType: 'Patient' } },
        async () => canonical,
      );

      const response = await handler(fhirEvent, context);
      const body = parseBody(response);

      expect(body.success).toBe(true);
      expect(body.data).toEqual(canonical);
      expect(body.fhir.entry[0].resource.id).toBe('01KQMPG288ANNZ9FAMMC1WZEH3');
      expect(body.fhir.entry[0].resource.isLoggedIn).toBeUndefined();
      expect(body.fhir.entry[0].resource.roleName).toBeUndefined();
      expect(body.fhir.entry[0].resource.identifier).toEqual([
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
          value: 'PI-MOOIY7IR307713',
        },
      ]);
      expect(body.fhir.entry[0].resource.text).toEqual(
        expect.objectContaining({ status: 'generated' }),
      );
    });

    it('auto-detects Patient and Practitioner when enabled is true', async () => {
      const canonical = {
        patientId: '01K',
        mrn: 'PI-123',
        reporterName: 'Dr Smith',
        reporterEmail: 'smith@test.com',
      };

      const handler = withApiHandler(
        { operation: 'alert.get', fhir: { enabled: true } },
        async () => canonical,
      );

      const response = await handler(fhirEvent, context);
      const body = parseBody(response);

      expect(body.data).toEqual(canonical);
      expect(body.fhir.entry.map((e: { resource: { resourceType: string } }) => e.resource.resourceType)).toEqual([
        'Patient',
        'Practitioner',
      ]);
    });

    it('returns standard JSON when FHIR is enabled but no resources are detected', async () => {
      const handler = withApiHandler(
        { operation: 'health', fhir: { enabled: true } },
        async () => ({ ok: true }),
      );

      const response = await handler(fhirEvent, context);
      const body = parseBody(response);

      expect(body.data).toEqual({ ok: true });
      expect(body.fhir).toBeUndefined();
      expect(body.resourceType).toBeUndefined();
    });

    it('aggregates FHIR resources in a collection bundle for FHIR callers', async () => {
      const patients = [
        {
          patientId: 'p1',
          mrn: 'MRN-1',
          lastName: 'A',
        },
        {
          patientId: 'p2',
          mrn: 'MRN-2',
          lastName: 'B',
        },
      ];

      const handler = withApiHandler(
        { operation: 'listPatients', fhir: { resourceType: 'Patient' } },
        async () => patients,
      );

      const response = await handler(fhirEvent, context);
      const body = parseBody(response);

      expect(body.data).toEqual({ items: patients });
      expect(body.fhir.resourceType).toBe('Bundle');
      expect(body.fhir.type).toBe('collection');
      expect(body.fhir.entry).toHaveLength(2);
      expect(body.fhir.entry[0].resource.id).toBe('p1');
      expect(body.fhir.entry[1].resource.id).toBe('p2');
    });

    it('returns data and fhir sibling for inbound FHIR POST bodies', async () => {
      const reverseSpy = jest
        .spyOn(FhirTransformationService.prototype, 'transformFhirToCanonical')
        .mockResolvedValue({
          patientId: 'p1',
          fullName: 'Jane Doe',
        });
      const projectionSpy = jest
        .spyOn(FhirTransformationService.prototype, 'transformToProjection')
        .mockResolvedValue([{ resourceType: 'Patient', id: 'p1' }]);

      let receivedBody: unknown;
      const handler = withApiHandler(
        { operation: 'createPatient', fhir: { resourceType: 'Patient' } },
        async (req) => {
          receivedBody = req.body;
          return req.body;
        },
      );

      const response = await handler(
        {
          httpMethod: 'POST',
          path: '/fhir/Patient',
          headers: {
            Accept: 'application/fhir+json',
            'Content-Type': 'application/fhir+json',
          },
          body: JSON.stringify({
            resourceType: 'Patient',
            id: 'p1',
            name: [{ text: 'Jane Doe' }],
          }),
          pathParameters: null,
          queryStringParameters: null,
        } as unknown as APIGatewayProxyEvent,
        context,
      );

      expect(reverseSpy).toHaveBeenCalledWith(
        'Patient',
        expect.objectContaining({ resourceType: 'Patient', id: 'p1' }),
        'default',
        { version: undefined },
      );
      expect(receivedBody).toEqual({
        patientId: 'p1',
        fullName: 'Jane Doe',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers?.['Content-Type']).toBe('application/json');

      const body = parseBody(response);
      expect(body.success).toBe(true);
      expect(body.data).toEqual({
        patientId: 'p1',
        fullName: 'Jane Doe',
      });
      expect(body.fhir.resourceType).toBe('Bundle');
      expect(body.fhir.entry[0].resource.id).toBe('p1');

      reverseSpy.mockRestore();
      projectionSpy.mockRestore();
    });
  });

  describe('transformation wiring', () => {
    it('passes client id from request context to transformation', async () => {
      const transformSpy = jest.spyOn(
        FhirTransformationService.prototype,
        'transformToProjection',
      );

      const handler = withApiHandler(
        {
          operation: 'getPatient',
          fhir: { resourceType: 'Patient' },
        },
        async () => ({ patientId: 'p1', mrn: 'MRN-1' }),
      );

      const event = {
        ...fhirEvent,
        headers: {
          Accept: 'application/fhir+json',
          'x-client-id': 'acme',
        },
      } as unknown as APIGatewayProxyEvent;

      await handler(event, context);

      expect(transformSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ clientId: 'acme', resourceTypes: ['Patient'] }),
      );

      transformSpy.mockRestore();
    });
  });

  describe('errors', () => {
    it('returns OperationOutcome when handler throws FhirValidationError', async () => {
      const handler = withApiHandler({ operation: 'getPatient' }, async () => {
        throw new FhirValidationError(
          [
            {
              severity: 'error',
              code: 'INVALID_RESOURCE_TYPE',
              diagnostics: 'Expected Patient but received Organization',
            },
          ],
          'Patient',
        );
      });

      const response = await handler(fhirEvent, context);

      expect(response.statusCode).toBe(422);
      expect(response.headers?.['Content-Type']).toBe('application/fhir+json');

      const body = parseBody(response);
      expect(body.resourceType).toBe('OperationOutcome');
    });
  });
});
