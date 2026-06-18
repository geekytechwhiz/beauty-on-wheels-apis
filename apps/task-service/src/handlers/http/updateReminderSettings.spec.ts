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
var mockHandleUpdateReminderSettings: jest.Mock;

jest.mock('../../controllers/task-http.controller', () => {
  mockHandleUpdateReminderSettings = jest.fn();
  return {
    getTaskHttpController: () => ({
      handleUpdateReminderSettings: mockHandleUpdateReminderSettings,
    }),
  };
});

import { main } from './updateReminderSettings';

function event(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'PUT',
    path: '/dev/tasks/rtask-abc/reminder-settings',
    pathParameters: { runtimeTaskInstanceId: 'rtask-abc' },
    queryStringParameters: null,
    headers: {
      Authorization: bearerToken({ 'custom:organizationID': 'org-1', 'custom:userID': 'user-1' }),
    },
    body: JSON.stringify({
      actorId: 'staff-1',
      reminderEnabled: true,
      reminderSettings: { channels: ['push', 'inApp'] },
      reason: 'Patient requested',
    }),
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

describe('updateReminderSettings handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    envCleanup();
  });

  beforeEach(() => {
    mockHandleUpdateReminderSettings.mockReset();
  });

  it('returns 200 with updated reminder settings', async () => {
    mockHandleUpdateReminderSettings.mockResolvedValue({
      runtimeTaskInstanceId: 'rtask-abc',
      reminderEnabled: true,
      reminderSettings: { channels: ['push', 'inApp'] },
      historyEntry: { historyEventType: 'reminderSettingsChange' },
    });

    const res = await main(event(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.reminderEnabled).toBe(true);
  });

  it('returns 422 when body is invalid', async () => {
    const res = await main(
      event({
        body: JSON.stringify({ actorId: 'staff-1' }),
      }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(422);
    expect(mockHandleUpdateReminderSettings).not.toHaveBeenCalled();
  });
});
