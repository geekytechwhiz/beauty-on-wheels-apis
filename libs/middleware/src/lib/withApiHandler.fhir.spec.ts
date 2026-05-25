import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

import { FhirValidationError } from '@api-hub/fhir';

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

import { withApiHandler } from './withApiHandler';

describe('withApiHandler FHIR integration', () => {
  const context = { awsRequestId: 'aws-req-test' } as Context;

  const baseEvent = {
    httpMethod: 'GET',
    path: '/fhir/Patient',
    headers: {
      Accept: 'application/fhir+json',
    },
    body: null,
    pathParameters: null,
    queryStringParameters: null,
  } as unknown as APIGatewayProxyEvent;

  it('returns standard success response when fhir option is omitted', async () => {
    const handler = withApiHandler({ operation: 'getPatient' }, async () => ({
      ok: true,
    }));

    const response = await handler(baseEvent, context);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ ok: true });
    expect(body.fhir).toBeUndefined();
  });

  it('preserves canonical data and adds strict FHIR projection in fhir field', async () => {
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

    const response = await handler(
      {
        ...baseEvent,
        path: '/alerts/a1',
        headers: {},
      } as unknown as APIGatewayProxyEvent,
      context,
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
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

  it('preserves flat patient payload in data and maps MRN to extension in fhir', async () => {
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

    const response = await handler(
      {
        ...baseEvent,
        path: '/alerts/a1',
        headers: {},
      } as unknown as APIGatewayProxyEvent,
      context,
    );

    const body = JSON.parse(response.body);
    expect(body.data).toEqual(canonical);
    expect(body.fhir.entry[0].resource.id).toBe('01KQMPG288ANNZ9FAMMC1WZEH3');
    expect(body.fhir.entry[0].resource.isLoggedIn).toBeUndefined();
    expect(body.fhir.entry[0].resource.roleName).toBeUndefined();
    expect(body.fhir.entry[0].resource.extension).toEqual(
      expect.arrayContaining([
        {
          url: 'https://myvirtualrx.com/fhir/custom/mrn',
          valueString: 'PI-MOOIY7IR307713',
        },
      ]),
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

    const response = await handler(baseEvent, context);
    const body = JSON.parse(response.body);

    expect(body.data).toEqual(canonical);
    expect(body.fhir.entry.map((e: { resource: { resourceType: string } }) => e.resource.resourceType)).toEqual([
      'Patient',
      'Practitioner',
    ]);
  });

  it('omits fhir when enabled but no resources are detected', async () => {
    const handler = withApiHandler(
      { operation: 'health', fhir: { enabled: true } },
      async () => ({ ok: true }),
    );

    const response = await handler(baseEvent, context);
    const body = JSON.parse(response.body);

    expect(body.data).toEqual({ ok: true });
    expect(body.fhir).toBeUndefined();
  });

  it('keeps array results in data.items and aggregates FHIR resources in fhir bundle', async () => {
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

    const response = await handler(baseEvent, context);
    const body = JSON.parse(response.body);

    expect(body.data).toEqual({ items: patients });
    expect(body.fhir.resourceType).toBe('Bundle');
    expect(body.fhir.type).toBe('collection');
    expect(body.fhir.entry).toHaveLength(2);
    expect(body.fhir.entry[0].resource.id).toBe('p1');
    expect(body.fhir.entry[1].resource.id).toBe('p2');
  });

  it('passes client id from request context to transformation', async () => {
    const transformSpy = jest
      .spyOn(
        (
          await import('@api-hub/fhir')
        ).FhirTransformationService.prototype,
        'transformToProjection',
      )
      .mockResolvedValue([{ resourceType: 'Patient', id: 'mock' }]);

    const handler = withApiHandler(
      {
        operation: 'getPatient',
        fhir: { resourceType: 'Patient' },
      },
      async () => ({ patientId: 'p1', mrn: 'MRN-1' }),
    );

    const event = {
      ...baseEvent,
      headers: { 'x-client-id': 'acme' },
    } as unknown as APIGatewayProxyEvent;

    await handler(event, context);

    expect(transformSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ clientId: 'acme', resourceTypes: ['Patient'] }),
    );

    transformSpy.mockRestore();
  });

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

    const response = await handler(baseEvent, context);

    expect(response.statusCode).toBe(422);
    expect(response.headers?.['Content-Type']).toBe('application/fhir+json');

    const body = JSON.parse(response.body);
    expect(body.resourceType).toBe('OperationOutcome');
  });
});
