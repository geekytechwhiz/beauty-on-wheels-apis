import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  bearerToken,
  minimalAlertRecord,
  setupHandlerTestEnv,
  testLambdaContext,
} from '../../__tests__/handler-test-utils';

jest.mock('@api-hub/middleware', () => {
  const { ApiResponse } = jest.requireActual<typeof import('@api-hub/utils')>('@api-hub/utils');

  function tryParseJson(body: unknown): unknown {
    if (typeof body !== 'string') return body;
    if (body.trim() === '') return undefined;
    try {
      return JSON.parse(body);
    } catch {
      return Symbol.for('invalid-json');
    }
  }

  return {
    withApiHandler:
      (options: any, handler: (req: any) => Promise<any>) =>
      async (event: any) => {
        if (event?.source === 'serverless-plugin-warmup') {
          return ApiResponse.ok(null, { title: 'SUCCESS', description: 'Warmup', severity: 'SUCCESS' }, { correlationId: 'unknown' });
        }

        const parsedBody = tryParseJson(event?.body);
        if (parsedBody === Symbol.for('invalid-json')) {
          return ApiResponse.unprocessableEntity(
            { title: 'INVALID_JSON', description: 'Invalid JSON body', severity: 'ERROR' },
            { correlationId: 'test-correlation-id' },
            { code: 'INVALID_JSON' },
          );
        }

        const authHeader = event?.headers?.Authorization ?? event?.headers?.authorization;
        const req = {
          event: any,
          params: event?.queryStringParameters ?? {},
          body: parsedBody,
          query: {},
          pathParameters: event?.pathParameters ?? undefined,
          context: {
            correlationId: 'test-correlation-id',
            awsRequestId: 'test-aws-request-id',
            logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
            authHeader,
          },
        };

        try {
          if (options?.bodySchema) {
            req.body = options.bodySchema.parse(req.body);
          }
          if (options?.validator) {
            await options.validator(req);
          }
          const out = await handler(req);
          return ApiResponse.ok(out, { title: 'SUCCESS', description: 'Request processed successfully', severity: 'SUCCESS' }, { correlationId: 'test-correlation-id' });
        } catch (e: any) {
          const statusCode = e?.statusCode ?? 500;
          const code = e?.code ?? 'INTERNAL_ERROR';
          return ApiResponse.error(
            statusCode,
            { title: code, description: e?.message ?? 'Error', severity: 'ERROR' },
            { correlationId: 'test-correlation-id' },
            { code },
          );
        }
      },
  };
});

// eslint-disable-next-line no-var
var mockListAlerts: jest.Mock;

jest.mock('@api-hub/alert-core', () => {
  mockListAlerts = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/alert-core')>('@api-hub/alert-core');
  return {
    ...actual,
    AlertService: jest.fn().mockImplementation(() => ({
      listAlerts: mockListAlerts,
    })),
  };
});

import { main } from './listAlerts';

describe('listAlerts HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });
  afterAll(() => envCleanup());
  beforeEach(() => mockListAlerts.mockReset());

  const context = testLambdaContext();

  function listEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
      httpMethod: 'GET',
      path: '/dev/alerts',
      pathParameters: null,
      queryStringParameters: {},
      headers: {
        Authorization: bearerToken({
          'custom:organizationID': 'org-1',
          'custom:userID': 'user-1',
        }),
      },
      body: null,
      ...overrides,
    } as unknown as APIGatewayProxyEvent;
  }

  it('returns 200 with items and maps toPublicAlert shape', async () => {
    const r = minimalAlertRecord();
    mockListAlerts.mockResolvedValue({ items: [r] });

    const result = await (main as any)(listEvent(), context);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}') as {
      success: boolean;
      data: { items: Array<{ orgId: string; alertId: string }> };
    };
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].orgId).toBe('org-1');
    expect(body.data.items[0].alertId).toBe(r.alertId);
    expect(mockListAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', queue: 'TEAM' }),
    );
  });

  it('includes nextToken when service returns it', async () => {
    const token = Buffer.from(JSON.stringify({ k: 'v' }), 'utf8').toString('base64url');
    mockListAlerts.mockResolvedValue({ items: [], nextToken: token });

    const result = await (main as any)(listEvent(), context);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}') as { data: { nextToken?: string } };
    expect(body.data.nextToken).toBe(token);
  });

  it('returns 400 for PATIENT queue without patientId', async () => {
    const result = await (main as any)(
      listEvent({ queryStringParameters: { queue: 'PATIENT' } }),
      context,
    );

    expect(result.statusCode).toBe(400);
    expect(mockListAlerts).not.toHaveBeenCalled();
  });

  it('returns 400 when patientId is set for TEAM queue', async () => {
    const result = await (main as any)(
      listEvent({
        queryStringParameters: { queue: 'TEAM', patientId: 'pat-x' },
      }),
      context,
    );

    expect(result.statusCode).toBe(400);
    expect(mockListAlerts).not.toHaveBeenCalled();
  });

  it('calls service with assignment user id query when set', async () => {
    mockListAlerts.mockResolvedValue({ items: [] });

    await (main as any)(
      listEvent({
        queryStringParameters: { assignment: '5fa85f64-5717-4562-b3fc-2c963f66afa8' },
      }),
      context,
    );

    expect(mockListAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        assignment: '5fa85f64-5717-4562-b3fc-2c963f66afa8',
      }),
    );
  });

  it('returns 401 without organization in token', async () => {
    const result = await (main as any)(
      listEvent({
        headers: { Authorization: bearerToken({ sub: 'u' }) },
      }),
      context,
    );

    expect(result.statusCode).toBe(401);
    expect(mockListAlerts).not.toHaveBeenCalled();
  });

  it('returns 400 when MY queue has no resolvable user id', async () => {
    const err = new Error('User id could not be resolved for MY queue') as Error & { statusCode: number };
    err.statusCode = 400;
    mockListAlerts.mockRejectedValue(err);

    const result = await (main as any)(
      listEvent({
        queryStringParameters: { queue: 'MY' },
        headers: {
          Authorization: bearerToken({ 'custom:organizationID': 'org-1' }),
        },
      }),
      context,
    );

    expect(result.statusCode).toBe(400);
    expect(mockListAlerts).toHaveBeenCalled();
  });

  it('calls service with PATIENT queue and patientId when both are valid', async () => {
    mockListAlerts.mockResolvedValue({ items: [] });

    await (main as any)(
      listEvent({
        queryStringParameters: { queue: 'PATIENT', patientId: 'pat-99' },
      }),
      context,
    );

    expect(mockListAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: 'PATIENT',
        patientId: 'pat-99',
      }),
    );
  });

  it('handles warmup', async () => {
    const result = await (main as any)({ source: 'serverless-plugin-warmup' } as unknown as APIGatewayProxyevent: any, context);
    expect(result.statusCode).toBe(200);
    expect(mockListAlerts).not.toHaveBeenCalled();
  });
});
