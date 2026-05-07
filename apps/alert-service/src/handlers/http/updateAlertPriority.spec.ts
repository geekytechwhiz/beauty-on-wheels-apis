import type { APIGatewayProxyEvent } from 'aws-lambda';

import {
  bearerToken,
  minimalAlertRecord,
  setupHandlerTestEnv,
  testLambdaContext,
} from '../../__tests__/handler-test-utils';

// eslint-disable-next-line no-var
var mockApplyPriority: jest.Mock;

jest.mock('@api-hub/alert-core', () => {
  mockApplyPriority = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/alert-core')>('@api-hub/alert-core');
  return {
    ...actual,
    AlertService: jest.fn().mockImplementation(() => ({
      applyPriority: mockApplyPriority,
    })),
  };
});

import { main } from './updateAlertPriority';

describe('updateAlertPriority HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });
  afterAll(() => envCleanup());
  beforeEach(() => mockApplyPriority.mockReset());

  const context = testLambdaContext();
  const alertId = minimalAlertRecord().alertId;

  function baseEvent(body: Record<string, unknown>, overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
      httpMethod: 'PATCH',
      path: `/dev/alerts/priority`,
      pathParameters: null,
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

  it('returns 200 with updated alert detail for single-select', async () => {
    const row = minimalAlertRecord({ priority: 'P1' } as any);
    mockApplyPriority.mockResolvedValue({ primaryAlert: row });

    const result = await main(
      baseEvent({ alertIds: [alertId], priority: 'P1' }),
      context,
    );

    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body ?? '{}') as { success: boolean; data: { alertId: string } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.alertId).toBe(alertId);
    expect(mockApplyPriority).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        alertIds: [alertId],
        priority: 'P1',
      }),
    );
  });

  it('returns 422 when priority is missing', async () => {
    const result = await main(baseEvent({ alertIds: [alertId] }), context);
    expect(result.statusCode).toBe(422);
    expect(mockApplyPriority).not.toHaveBeenCalled();
  });

  it('handles serverless-plugin-warmup', async () => {
    const warmup = { source: 'serverless-plugin-warmup' } as unknown as APIGatewayProxyEvent;
    const result = await main(warmup, context);
    expect(result.statusCode).toBe(200);
    expect(mockApplyPriority).not.toHaveBeenCalled();
  });
});

