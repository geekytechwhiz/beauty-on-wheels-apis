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
var mockGetRuntimeTaskDetail: jest.Mock;

jest.mock('@api-hub/task-core', () => {
  mockGetRuntimeTaskDetail = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      getRuntimeTaskDetail: mockGetRuntimeTaskDetail,
    })),
  };
});

import { main } from './getRuntimeTask';

function baseEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/dev/tasks/rtask-1',
    pathParameters: { runtimeTaskInstanceId: 'rtask-1' },
    queryStringParameters: null,
    headers: { Authorization: bearerToken({ 'custom:organizationID': 'org-1' }) },
    body: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

describe('getRuntimeTask HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });
  afterAll(() => envCleanup());

  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with task detail', async () => {
    mockGetRuntimeTaskDetail.mockResolvedValue({ task: { runtimeTaskInstanceId: 'rtask-1' }, reminders: [] });
    const res = await main(baseEvent(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.task.runtimeTaskInstanceId).toBe('rtask-1');
  });

  it('returns 400 when path param missing', async () => {
    const res = await main(baseEvent({ pathParameters: null }), testLambdaContext());
    expect(res.statusCode).toBe(400);
    expect(mockGetRuntimeTaskDetail).not.toHaveBeenCalled();
  });
});
