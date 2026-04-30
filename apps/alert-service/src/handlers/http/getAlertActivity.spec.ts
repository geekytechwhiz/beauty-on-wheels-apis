import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  bearerToken,
  setupHandlerTestEnv,
  testLambdaContext,
  baseGetEvent,
} from '../../__tests__/handler-test-utils';

// eslint-disable-next-line no-var
var mockListAlertActivity: jest.Mock;

jest.mock('@api-hub/alert-core', () => {
  mockListAlertActivity = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/alert-core')>('@api-hub/alert-core');
  return {
    ...actual,
    AlertService: jest.fn().mockImplementation(() => ({
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
  beforeEach(() => mockListAlertActivity.mockReset());

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

    const result = await main(baseGetEvent({ pathParameters: { alertId: 'alt-1' } }), context);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}') as { success: boolean; data: { items: typeof items } };
    expect(body.success).toBe(true);
    expect(body.data.items).toEqual(items);
    expect(mockListAlertActivity).toHaveBeenCalledWith('alt-1', 'org-1');
  });

  it('returns 400 when alertId missing', async () => {
    const event = baseGetEvent({ pathParameters: {} });
    const result = await main(event, context);

    expect(result.statusCode).toBe(400);
    expect(mockListAlertActivity).not.toHaveBeenCalled();
  });

  it('returns 401 without organization', async () => {
    const event = baseGetEvent({
      headers: { Authorization: bearerToken({ sub: 'u' }) },
    });
    const result = await main(event, context);

    expect(result.statusCode).toBe(401);
    expect(mockListAlertActivity).not.toHaveBeenCalled();
  });

  it('returns 404 when service returns null', async () => {
    mockListAlertActivity.mockResolvedValue(null);

    const result = await main(baseGetEvent({ pathParameters: { alertId: 'alt-x' } }), context);

    expect(result.statusCode).toBe(404);
  });

  it('handles warmup', async () => {
    const result = await main({ source: 'serverless-plugin-warmup' } as unknown as APIGatewayProxyEvent, context);
    expect(result.statusCode).toBe(200);
    expect(mockListAlertActivity).not.toHaveBeenCalled();
  });
});
