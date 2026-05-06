import type { APIGatewayProxyEvent } from 'aws-lambda';

import {
  bearerToken,
  setupHandlerTestEnv,
  testLambdaContext,
} from '../../__tests__/handler-test-utils';

// eslint-disable-next-line no-var
var mockAddNote: jest.Mock;

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
      activityId: 'act-1',
      alertId: 'a-1',
      activityType: 'NOTE_ADDED',
      activityTimestamp: Date.now(),
      performedBy: 'user-1',
      performedByDisplayName: 'User One',
      activityComment: 'hello',
    });

    const result = await main(baseEvent('a-1', { comment: 'hello' }), context);

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
    const result = await main(baseEvent('a-1', { comment: 'hello', performedByDisplayName: '' }), context);
    expect(result.statusCode).toBe(422);
    expect(mockAddNote).not.toHaveBeenCalled();
  });
});

