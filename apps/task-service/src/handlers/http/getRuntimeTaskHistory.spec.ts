import type { APIGatewayProxyEvent } from 'aws-lambda';
import { bearerToken, setupHandlerTestEnv, testLambdaContext } from '../../__tests__/handler-test-utils';

jest.mock('@api-hub/middleware', () => {
  const { ApiResponse } = jest.requireActual<typeof import('@api-hub/utils')>('@api-hub/utils');
  return {
    withApiHandler:
      (options: { validator?: (req: unknown) => void | Promise<void> }, handler: (req: unknown) => Promise<unknown>) =>
      async (event: APIGatewayProxyEvent) => {
        const authHeader = event?.headers?.Authorization ?? event?.headers?.authorization;
        const req = {
          event,
          params: event?.queryStringParameters ?? {},
          body: undefined,
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
          if (options?.validator) await options.validator(req);
          const out = await handler(req);
          return ApiResponse.ok(out, { title: 'OK', description: 'ok', severity: 'SUCCESS' }, { correlationId: 'c' });
        } catch (e: unknown) {
          const err = e as { statusCode?: number; code?: string; message?: string };
          return ApiResponse.error(
            err?.statusCode ?? 500,
            { title: err?.code ?? 'ERR', description: err?.message ?? 'Error', severity: 'ERROR' },
            { correlationId: 'c' },
            { code: err?.code },
          );
        }
      },
  };
});

// eslint-disable-next-line no-var
var mockGetRuntimeTaskHistory: jest.Mock;

jest.mock('@api-hub/task-core', () => {
  mockGetRuntimeTaskHistory = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      getRuntimeTaskHistory: mockGetRuntimeTaskHistory,
    })),
  };
});

import { main } from './getRuntimeTaskHistory';

function baseEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/dev/tasks/rtask-1/history',
    pathParameters: { runtimeTaskInstanceId: 'rtask-1' },
    queryStringParameters: { pageSize: '25' },
    headers: { Authorization: bearerToken({ 'custom:organizationID': 'org-1' }) },
    body: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

describe('getRuntimeTaskHistory HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });
  afterAll(() => envCleanup());

  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with history page', async () => {
    mockGetRuntimeTaskHistory.mockResolvedValue({ items: [], nextToken: undefined });
    const res = await main(baseEvent(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    expect(mockGetRuntimeTaskHistory).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeTaskInstanceId: 'rtask-1', pageSize: 25 }),
    );
  });
});
