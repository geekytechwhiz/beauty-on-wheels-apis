import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  bearerToken,
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
// eslint-disable-next-line no-var
var mockListAlertActivity: jest.Mock;

jest.mock('@api-hub/alert-core', () => {
  mockGetAlert = jest.fn();
  mockListAlertActivity = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/alert-core')>('@api-hub/alert-core');
  return {
    ...actual,
    AlertService: jest.fn().mockImplementation(() => ({
      getAlert: mockGetAlert,
      listAlertActivity: mockListAlertActivity,
    })),
  };
});

import { main } from './getAlertActivity';

describe('getAlertActivity HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });
  afterAll(() => envCleanup());
  beforeEach(() => {
    mockGetAlert.mockReset();
    mockListAlertActivity.mockReset();
  });

  const context = testLambdaContext();

  it('returns 200 with activity items', async () => {
    const items = [
      {
        activityId: 'a1',
        activityType: 'ALERT_CREATED',
        performedAt: '2026-01-15T10:00:00.000Z',
      },
    ];
    mockListAlertActivity.mockResolvedValue(items);

    const result = await (main as any)(baseGetEvent({ pathParameters: { alertId: 'alt-1' } }), context);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}') as { success: boolean; data: { items: typeof items } };
    expect(body.success).toBe(true);
    expect(body.data.items).toEqual(items);
    expect(mockListAlertActivity).toHaveBeenCalledWith('alt-1', 'org-1', { notesOnly: false });
  });

  it('returns 400 when alertId missing', async () => {
    const event = baseGetEvent({ pathParameters: {} });
    const result = await (main as any)(event, context);

    expect(result.statusCode).toBe(400);
    expect(mockListAlertActivity).not.toHaveBeenCalled();
  });

  it('returns 401 without organization', async () => {
    const event = baseGetEvent({
      headers: { Authorization: bearerToken({ sub: 'u' }) },
    });
    const result = await (main as any)(event, context);

    expect(result.statusCode).toBe(401);
    expect(mockListAlertActivity).not.toHaveBeenCalled();
  });

  it('returns 200 when no activity is returned', async () => {
    mockListAlertActivity.mockResolvedValue(undefined);

    const result = await (main as any)(baseGetEvent({ pathParameters: { alertId: 'alt-x' } }), context);

    expect(result.statusCode).toBe(200);
  });

  it('passes notesOnly=true when query string set', async () => {
    mockListAlertActivity.mockResolvedValue([]);
    const event = baseGetEvent({
      pathParameters: { alertId: 'alt-1' },
      queryStringParameters: { notesOnly: 'true' },
    });
    await (main as any)(event, context);
    expect(mockListAlertActivity).toHaveBeenCalledWith('alt-1', 'org-1', { notesOnly: true });
  });

  it('handles warmup', async () => {
    const result = await (main as any)({ source: 'serverless-plugin-warmup' } as unknown as APIGatewayProxyEvent, context);
    expect(result.statusCode).toBe(200);
    expect(mockListAlertActivity).not.toHaveBeenCalled();
  });
});
