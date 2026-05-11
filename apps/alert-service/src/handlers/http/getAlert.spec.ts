import {
  bearerToken,
  minimalAlertRecord,
  setupHandlerTestEnv,
  testLambdaContext,
  baseGetEvent,
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
          event,
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
var mockGetAlert: jest.Mock;

jest.mock('@api-hub/alert-core', () => {
  mockGetAlert = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/alert-core')>('@api-hub/alert-core');
  return {
    ...actual,
    AlertService: jest.fn().mockImplementation(() => ({
      getAlert: mockGetAlert,
    })),
  };
});

import { main } from './getAlert';

describe('getAlert HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });
  afterAll(() => envCleanup());
  beforeEach(() => mockGetAlert.mockReset());

  const context = testLambdaContext();

  it('returns 200 with alert detail when found', async () => {
    const row = minimalAlertRecord({ alertId: 'alt-1', id: 'alt-1', pk: 'ALERT#alt-1' });
    mockGetAlert.mockResolvedValue(row);

    const result = await (main as any)(baseGetEvent({ pathParameters: { alertId: 'alt-1' } }), context);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}') as { success: boolean; data: { alertId: string; orgId: string } };
    expect(body.success).toBe(true);
    expect(body.data.alertId).toBe('alt-1');
    expect(body.data.orgId).toBe('org-1');
    expect(mockGetAlert).toHaveBeenCalledWith('alt-1', 'org-1');
  });

  it('returns 400 when alertId is missing', async () => {
    const event = baseGetEvent({
      pathParameters: {},
    });

    const result = await (main as any)(event, context);

    expect(result.statusCode).toBe(400);
    expect(mockGetAlert).not.toHaveBeenCalled();
  });

  it('returns 401 when organization is missing from token', async () => {
    mockGetAlert.mockResolvedValue(null);
    const event = baseGetEvent({
      headers: { Authorization: bearerToken({ sub: 'u1' }) },
    });

    const result = await (main as any)(event, context);

    expect(result.statusCode).toBe(401);
    expect(mockGetAlert).not.toHaveBeenCalled();
  });

  it('returns 404 when alert not found or wrong org', async () => {
    mockGetAlert.mockResolvedValue(null);

    const result = await (main as any)(baseGetEvent({ pathParameters: { alertId: 'missing' } }), context);

    expect(result.statusCode).toBe(404);
    expect(mockGetAlert).toHaveBeenCalledWith('missing', 'org-1');
  });

  it('handles serverless-plugin-warmup', async () => {
    const warmup = { source: 'serverless-plugin-warmup' } as unknown as APIGatewayProxyEvent;
    const result = await (main as any)(warmup, context);
    expect(result.statusCode).toBe(200);
    expect(mockGetAlert).not.toHaveBeenCalled();
  });
});
