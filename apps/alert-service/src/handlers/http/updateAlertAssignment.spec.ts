import type { APIGatewayProxyEvent } from 'aws-lambda';

import {
  bearerToken,
  minimalAlertRecord,
  setupHandlerTestEnv,
  testLambdaContext,
} from '../../__tests__/handler-test-utils';

// eslint-disable-next-line no-var
var mockApplyAssignment: jest.Mock;

jest.mock('@api-hub/alert-core', () => {
  mockApplyAssignment = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/alert-core')>('@api-hub/alert-core');
  return {
    ...actual,
    AlertService: jest.fn().mockImplementation(() => ({
      applyAssignment: mockApplyAssignment,
    })),
  };
});

import { main } from './updateAlertAssignment';

describe('updateAlertAssignment HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });
  afterAll(() => envCleanup());
  beforeEach(() => mockApplyAssignment.mockReset());

  const context = testLambdaContext();
  const alertId = minimalAlertRecord().alertId;

  function baseEvent(body: Record<string, unknown>, overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
      httpMethod: 'POST',
      path: `/dev/alerts/assignment`,
      pathParameters: null,
      queryStringParameters: null,
      headers: {
        Authorization: bearerToken({
          'custom:organizationID': 'org-1',
          'custom:userID': 'user-1',
        }),
      },
      body: JSON.stringify(body),
      ...overrides,
    } as unknown as APIGatewayProxyEvent;
  }

  it('returns 200 with updated alert detail for single-select', async () => {
    const row = minimalAlertRecord();
    mockApplyAssignment.mockResolvedValue({ primaryAlert: row });

    const result = await main(
      baseEvent({ alertIds: [alertId], action: 'ASSIGN', assignToUserId: 'user-2' }),
      context,
    );

    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body ?? '{}') as { success: boolean; data: { alertId: string } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.alertId).toBe(alertId);
    expect(mockApplyAssignment).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        alertIds: [alertId],
        action: 'ASSIGN',
        assignToUserId: 'user-2',
      }),
    );
  });

  it('derives assignToUserId for ASSIGN_TO_SELF from token', async () => {
    mockApplyAssignment.mockResolvedValue({});

    await main(baseEvent({ alertIds: [alertId], action: 'ASSIGN_TO_SELF' }), context);

    expect(mockApplyAssignment).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        action: 'ASSIGN_TO_SELF',
        assignToUserId: 'user-1',
      }),
    );
  });

  it('returns 422 when assignToUserId missing for ASSIGN', async () => {
    const result = await main(baseEvent({ alertIds: [alertId], action: 'ASSIGN' }), context);
    expect(result.statusCode).toBe(422);
    expect(mockApplyAssignment).not.toHaveBeenCalled();
  });

  it('handles serverless-plugin-warmup', async () => {
    const warmup = { source: 'serverless-plugin-warmup' } as unknown as APIGatewayProxyEvent;
    const result = await main(warmup, context);
    expect(result.statusCode).toBe(200);
    expect(mockApplyAssignment).not.toHaveBeenCalled();
  });
});

