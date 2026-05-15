import type { APIGatewayProxyEvent } from 'aws-lambda';

import {
  bearerToken,
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
var mockAddNote: jest.Mock;

jest.mock('../../handlers/events/publisher/alert-publisher', () => ({
  publishAlertIntents: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@api-hub/alert-core', () => {
  mockAddNote = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/alert-core')>('@api-hub/alert-core');
  return {
    ...actual,
    AlertService: jest.fn().mockImplementation(() => ({
      addNote: mockAddNote,
    })),
  };
});

import { main } from './addAlertNote';
import mainDefault from './addAlertNote';

describe('addAlertNote HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });
  afterAll(() => envCleanup());
  beforeEach(() => mockAddNote.mockReset());

  const context = testLambdaContext();

  function baseEvent(
    alertId: string,
    body: Record<string, unknown>,
    overrides: Partial<APIGatewayProxyEvent> = {},
  ): APIGatewayProxyEvent {
    return {
      httpMethod: 'POST',
      path: `/dev/alerts/${alertId}/notes`,
      pathParameters: { alertId },
      queryStringParameters: null,
      headers: {
        Authorization: bearerToken({
          'custom:organizationID': 'org-1',
          'custom:userID': 'user-1',
        }),
      },
      body: JSON.stringify({ performedByDisplayName: 'User One', ...body }),
      ...overrides,
    } as unknown as APIGatewayProxyEvent;
  }

  it('returns 200 when note succeeds', async () => {
    mockAddNote.mockResolvedValue({
      activity: {
        activityId: 'act-1',
        alertId: 'a-1',
        activityType: 'NOTE_ADDED',
        activityTimestamp: Date.now(),
        performedBy: 'user-1',
        performedByDisplayName: 'User One',
        activityComment: 'hello',
      },
      publishIntents: [
        {
          kind: 'NOTE_ADDED',
          activity: {
            activityId: 'act-1',
            alertId: 'a-1',
            activityType: 'NOTE_ADDED',
            activityTimestamp: Date.now(),
            performedBy: 'user-1',
            performedByDisplayName: 'User One',
            activityComment: 'hello',
          },
          alertId: 'a-1',
          organizationId: 'org-1',
          patientId: 'pat-1',
        },
      ],
    });

    const result = await mainDefault(baseEvent('a-1', { comment: 'hello' }), context);

    expect(result.statusCode).toBe(200);
    expect(mockAddNote).toHaveBeenCalledWith(
      'a-1',
      'org-1',
      'hello',
      'user-1',
      'User One',
    );
  });

  it('returns 422 when performedByDisplayName missing', async () => {
    const result = await (main as any)(baseEvent('a-1', { comment: 'hello', performedByDisplayName: '' }), context);
    expect(result.statusCode).toBe(422);
    expect(mockAddNote).not.toHaveBeenCalled();
  });
});


