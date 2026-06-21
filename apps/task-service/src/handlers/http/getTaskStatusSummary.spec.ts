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
          if (options?.validator) {
            await options.validator(req);
          }
          const out = await handler(req);
          return ApiResponse.ok(
            out,
            { title: 'SUCCESS', description: 'Request processed successfully', severity: 'SUCCESS' },
            { correlationId: 'test-correlation-id' },
          );
        } catch (e: unknown) {
          const err = e as { statusCode?: number; code?: string; message?: string };
          const statusCode = err?.statusCode ?? 500;
          const code = err?.code ?? 'INTERNAL_ERROR';
          return ApiResponse.error(
            statusCode,
            { title: code, description: err?.message ?? 'Error', severity: 'ERROR' },
            { correlationId: 'test-correlation-id' },
            { code },
          );
        }
      },
  };
});

// eslint-disable-next-line no-var
var mockHandleGetTaskStatusSummary: jest.Mock;

jest.mock('../../controllers/task-http.controller', () => {
  mockHandleGetTaskStatusSummary = jest.fn();
  return {
    getTaskHttpController: () => ({
      handleGetTaskStatusSummary: mockHandleGetTaskStatusSummary,
    }),
  };
});

import { main } from './getTaskStatusSummary';

function event(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/dev/care-plans/cp-1/task-status-summary',
    pathParameters: { carePlanInstanceId: 'cp-1' },
    queryStringParameters: { patientId: 'pat-1', workflowStage: 'onboarding' },
    headers: {
      Authorization: bearerToken({ 'custom:organizationID': 'org-1', 'custom:userID': 'user-1' }),
    },
    body: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

describe('getTaskStatusSummary handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    envCleanup();
  });

  beforeEach(() => {
    mockHandleGetTaskStatusSummary.mockReset();
  });

  it('returns 200 with readiness summary', async () => {
    mockHandleGetTaskStatusSummary.mockResolvedValue({
      orgId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: 'cp-1',
      readinessStatus: 'ready',
      counts: { total: 1, requiredTotal: 1, completed: 1, missed: 0, active: 0, scheduled: 0 },
    });

    const res = await main(event(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.readinessStatus).toBe('ready');
  });

  it('returns 400 when patientId is missing', async () => {
    const res = await main(
      event({ queryStringParameters: { workflowStage: 'onboarding' } }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(400);
    expect(mockHandleGetTaskStatusSummary).not.toHaveBeenCalled();
  });
});
