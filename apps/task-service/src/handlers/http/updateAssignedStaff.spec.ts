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
var mockHandleUpdateAssignedStaff: jest.Mock;

jest.mock('../../controllers/task-http.controller', () => {
  mockHandleUpdateAssignedStaff = jest.fn();
  return {
    getTaskHttpController: () => ({
      handleUpdateAssignedStaff: mockHandleUpdateAssignedStaff,
    }),
  };
});

import { main } from './updateAssignedStaff';

function event(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'PUT',
    path: '/dev/tasks/rtask-staff-1/assigned-staff',
    pathParameters: { runtimeTaskInstanceId: 'rtask-staff-1' },
    queryStringParameters: null,
    headers: {
      Authorization: bearerToken({ 'custom:organizationID': 'org-1', 'custom:userID': 'user-1' }),
    },
    body: JSON.stringify({
      actorId: 'staff-manager-1',
      assignedToStaffId: 'staff-2',
      assignedToStaffDisplayName: 'Nurse Two',
      reason: 'Shift handoff',
    }),
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

describe('updateAssignedStaff handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    envCleanup();
  });

  beforeEach(() => {
    mockHandleUpdateAssignedStaff.mockReset();
  });

  it('returns 200 with reassignment result', async () => {
    mockHandleUpdateAssignedStaff.mockResolvedValue({
      runtimeTaskInstanceId: 'rtask-staff-1',
      task: { assignedToStaffId: 'staff-2' },
      historyEntry: { historyEventType: 'assignedToStaffChange' },
    });

    const res = await main(event(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.assignedToStaffId ?? body.data.task?.assignedToStaffId).toBeDefined();
  });

  it('returns 422 when body is invalid', async () => {
    const res = await main(
      event({
        body: JSON.stringify({ actorId: 'staff-1' }),
      }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(422);
    expect(mockHandleUpdateAssignedStaff).not.toHaveBeenCalled();
  });
});
