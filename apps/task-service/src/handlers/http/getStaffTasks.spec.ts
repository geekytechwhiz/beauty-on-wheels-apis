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
var mockListStaffTasks: jest.Mock;

jest.mock('@api-hub/task-core', () => {
  mockListStaffTasks = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      listStaffTasks: mockListStaffTasks,
    })),
  };
});

import { main } from './getStaffTasks';

function baseStaffListEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/dev/staff/tasks',
    pathParameters: null,
    queryStringParameters: { staffUserId: 'staff-1' },
    headers: {
      Authorization: bearerToken({
        'custom:organizationID': 'org-1',
        'custom:userID': 'staff-1',
      }),
    },
    body: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

describe('getStaffTasks HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    envCleanup();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with paginated staff tasks on success', async () => {
    mockListStaffTasks.mockResolvedValue({
      items: [{ runtimeTaskInstanceId: 'rtask-1', currentState: 'open' }],
    });

    const res = await main(baseStaffListEvent(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.items).toHaveLength(1);
    expect(mockListStaffTasks).toHaveBeenCalledWith({
      organizationId: 'org-1',
      staffUserId: 'staff-1',
      patientId: undefined,
      carePlanInstanceId: undefined,
      currentState: undefined,
      pageSize: 50,
      nextToken: undefined,
    });
  });

  it('returns 403 when staffUserId does not match JWT user', async () => {
    const res = await main(
      baseStaffListEvent({
        queryStringParameters: { staffUserId: 'other-staff' },
      }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(403);
    expect(mockListStaffTasks).not.toHaveBeenCalled();
  });

  it('returns 400 when staffUserId is missing', async () => {
    const res = await main(
      baseStaffListEvent({ queryStringParameters: {} }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(400);
    expect(mockListStaffTasks).not.toHaveBeenCalled();
  });
});
