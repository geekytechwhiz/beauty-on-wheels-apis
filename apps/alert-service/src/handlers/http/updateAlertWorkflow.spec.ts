import type { APIGatewayProxyEvent } from 'aws-lambda';

import {
  bearerToken,
  minimalAlertRecord,
  setupHandlerTestEnv,
  testLambdaContext,
} from '../../__tests__/handler-test-utils';

// eslint-disable-next-line no-var
var mockApplyWorkflow: jest.Mock;

jest.mock('@api-hub/alert-core', () => {
  mockApplyWorkflow = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/alert-core')>('@api-hub/alert-core');
  return {
    ...actual,
    AlertService: jest.fn().mockImplementation(() => ({
      applyWorkflow: mockApplyWorkflow,
    })),
  };
});

import { main } from './updateAlertWorkflow';

describe('updateAlertWorkflow HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });
  afterAll(() => envCleanup());
  beforeEach(() => mockApplyWorkflow.mockReset());

  const context = testLambdaContext();
  const alertId = minimalAlertRecord().alertId;

  function baseEvent(body: Record<string, unknown>, overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
      httpMethod: 'POST',
      path: `/dev/alerts/workflow`,
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

  it('returns 200 with succeeded/failed when workflow succeeds', async () => {
    mockApplyWorkflow.mockResolvedValue({
      succeeded: [alertId],
      failed: [],
    });

    const result = await main(baseEvent({ alertIds: [alertId], action: 'START_WORK' }), context);

    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body ?? '{}') as {
      success: boolean;
      data: { alertIds: string[]; succeeded: string[]; failed: unknown[] };
    };
    expect(parsed.success).toBe(true);
    expect(parsed.data.alertIds).toEqual([alertId]);
    expect(parsed.data.succeeded).toEqual([alertId]);
    expect(parsed.data.failed).toEqual([]);
    expect(mockApplyWorkflow).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        alertIds: [alertId],
        action: 'START_WORK',
      }),
    );
  });

  it('maps ASSIGN to ASSIGN with assignToUserId', async () => {
    mockApplyWorkflow.mockResolvedValue({
      succeeded: [alertId],
      failed: [],
    });

    await main(
      baseEvent({
        alertIds: [alertId],
        action: 'ASSIGN',
        assignedToUserId: 'user-assignee-1',
        assigneeDisplayName: 'Assignee One',
      }),
      context,
    );

    expect(mockApplyWorkflow).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        action: 'ASSIGN',
        assignToUserId: 'user-assignee-1',
      }),
    );
  });

  it('returns 422 when OTHER resolve without comment', async () => {
    const result = await main(
      baseEvent({
        alertIds: [alertId],
        action: 'RESOLVE',
        reasonCode: 'OTHER',
      }),
      context,
    );

    expect(result.statusCode).toBe(422);
    expect(mockApplyWorkflow).not.toHaveBeenCalled();
  });

  it('returns 409 when service reports ILLEGAL_TRANSITION', async () => {
    mockApplyWorkflow.mockResolvedValue({
      succeeded: [],
      failed: [
        {
          alertId,
          code: 'ILLEGAL_TRANSITION',
          message: 'RESUME is not valid from state UNASSIGNED',
        },
      ],
    });

    const result = await main(baseEvent({ alertIds: [alertId], action: 'RESUME_WORK' }), context);

    expect(result.statusCode).toBe(409);
    expect(mockApplyWorkflow).toHaveBeenCalled();
  });

  it('returns 404 when alert not in org', async () => {
    mockApplyWorkflow.mockResolvedValue({
      succeeded: [],
      failed: [{ alertId, code: 'NOT_FOUND', message: 'Alert not found' }],
    });

    const result = await main(baseEvent({ alertIds: [alertId], action: 'START_WORK' }), context);

    expect(result.statusCode).toBe(404);
  });

  it('returns 422 when alertIds is missing', async () => {
    const result = await main(
      baseEvent(
        { action: 'START_WORK' },
      ),
      context,
    );

    expect(result.statusCode).toBe(422);
    expect(mockApplyWorkflow).not.toHaveBeenCalled();
  });

  it('handles serverless-plugin-warmup', async () => {
    const warmup = { source: 'serverless-plugin-warmup' } as unknown as APIGatewayProxyEvent;
    const result = await main(warmup, context);
    expect(result.statusCode).toBe(200);
    expect(mockApplyWorkflow).not.toHaveBeenCalled();
  });
});
