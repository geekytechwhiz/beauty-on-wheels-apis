import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  bearerToken,
  setupHandlerTestEnv,
  testLambdaContext,
} from '../../__tests__/handler-test-utils';

jest.mock('@api-hub/middleware', () => {
  const { ApiResponse } = jest.requireActual<typeof import('@api-hub/utils')>('@api-hub/utils');

  return {
    withApiHandler:
      (options: any, handler: (req: any) => Promise<any>) =>
      async (event: any) => {
        const parsedBody =
          typeof event?.body === 'string' ? JSON.parse(event.body) : event?.body;
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
          return ApiResponse.ok(
            out,
            { title: 'SUCCESS', description: 'Request processed successfully', severity: 'SUCCESS' },
            { correlationId: 'test-correlation-id' },
          );
        } catch (e: any) {
          if (e?.name === 'ZodError') {
            return ApiResponse.unprocessableEntity(
              {
                title: 'VALIDATION_ERROR',
                description: e?.issues?.[0]?.message ?? 'Validation failed',
                severity: 'ERROR',
              },
              { correlationId: 'test-correlation-id' },
              { code: 'VALIDATION_ERROR' },
            );
          }
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
var mockHandleUpdateRuntimeTask: jest.Mock;

jest.mock('../../controllers/task-http.controller', () => {
  mockHandleUpdateRuntimeTask = jest.fn();
  return {
    getTaskHttpController: () => ({
      handleUpdateRuntimeTask: mockHandleUpdateRuntimeTask,
    }),
  };
});

import { main } from './updateRuntimeTask';

function event(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'PATCH',
    path: '/dev/tasks/rtask-abc',
    pathParameters: { runtimeTaskInstanceId: 'rtask-abc' },
    queryStringParameters: null,
    headers: {
      Authorization: bearerToken({ 'custom:organizationID': 'org-1', 'custom:userID': 'user-1' }),
    },
    body: JSON.stringify({
      actorId: 'staff-1',
      displayTitle: 'Complete daily blood pressure check',
      description: 'Use home cuff before breakfast',
      reason: 'Care plan wording updated',
    }),
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

describe('updateRuntimeTask handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    envCleanup();
  });

  beforeEach(() => {
    mockHandleUpdateRuntimeTask.mockReset();
  });

  it('returns 200 with updated task metadata', async () => {
    mockHandleUpdateRuntimeTask.mockResolvedValue({
      runtimeTaskInstanceId: 'rtask-abc',
      task: { displayTitle: 'Complete daily blood pressure check' },
      historyEntry: { historyEventType: 'taskMetadataChange' },
    });

    const res = await main(event(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.task.displayTitle).toBe('Complete daily blood pressure check');
  });

  it('returns 422 when no mutable fields are provided', async () => {
    const res = await main(
      event({
        body: JSON.stringify({ actorId: 'staff-1' }),
      }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(422);
    expect(mockHandleUpdateRuntimeTask).not.toHaveBeenCalled();
  });
});
