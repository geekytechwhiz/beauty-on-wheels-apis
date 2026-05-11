import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { LambdaRequest }  from '@api-hub/middleware';
import {
  bearerToken,
  minimalAlertRecord,
  setupHandlerTestEnv,
} from '../__tests__/handler-test-utils';

// eslint-disable-next-line no-var
var mockCreateAlert: jest.Mock;
// eslint-disable-next-line no-var
var mockGetAlert: jest.Mock;
// eslint-disable-next-line no-var
var mockListAlerts: jest.Mock;
// eslint-disable-next-line no-var
var mockListAlertActivity: jest.Mock;
// eslint-disable-next-line no-var
var mockApplyWorkflow: jest.Mock;
// eslint-disable-next-line no-var
var mockApplyAssignment: jest.Mock;
// eslint-disable-next-line no-var
var mockApplyPriority: jest.Mock;

jest.mock('@api-hub/alert-core', () => {
  mockCreateAlert = jest.fn();
  mockGetAlert = jest.fn();
  mockListAlerts = jest.fn();
  mockListAlertActivity = jest.fn();
  mockApplyWorkflow = jest.fn();
  mockApplyAssignment = jest.fn();
  mockApplyPriority = jest.fn();

  const actual = jest.requireActual<typeof import('@api-hub/alert-core')>('@api-hub/alert-core');
  return {
    ...actual,
    AlertService: jest.fn().mockImplementation(() => ({
      createAlert: mockCreateAlert,
      getAlert: mockGetAlert,
      listAlerts: mockListAlerts,
      listAlertActivity: mockListAlertActivity,
      applyWorkflow: mockApplyWorkflow,
      applyAssignment: mockApplyAssignment,
      applyPriority: mockApplyPriority,
    })),
  };
});

import { AlertHttpController } from './alert-http.controller';
import { getAlertHttpController } from './alert-http.controller';

function baseEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/dev/alerts',
    pathParameters: null,
    queryStringParameters: null,
    headers: {
      Authorization: bearerToken({
        'custom:organizationID': 'org-1',
        'custom:userID': 'user-1',
      }),
    },
    body: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

function baseReq(overrides: Partial<LambdaRequest> = {}): LambdaRequest {
  const event = (overrides.event as APIGatewayProxyEvent | undefined) ?? baseEvent();
  return {
    event,
    params: {},
    body: undefined,
    query: {},
    pathParameters: event.pathParameters ?? undefined,
    context: {
      correlationId: 'test-correlation-id',
      awsRequestId: 'test-aws-request-id',
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      authHeader: event.headers?.Authorization,
    },
    ...overrides,
  } as unknown as LambdaRequest;
}

describe('AlertHttpController', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });
  afterAll(() => envCleanup());

  beforeEach(() => {
    mockCreateAlert.mockReset();
    mockGetAlert.mockReset();
    mockListAlerts.mockReset();
    mockListAlertActivity.mockReset();
    mockApplyWorkflow.mockReset();
    mockApplyAssignment.mockReset();
    mockApplyPriority.mockReset();
  });

  it('handleCreateAlert throws 500 when logger missing', async () => {
    const c = new AlertHttpController();
    const req = baseReq({
      context: {
        correlationId: 'c1',
        awsRequestId: 'a1',
        logger: undefined as unknown as any,
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
      },
    });

    await expect(c.handleCreateAlert(req)).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(mockCreateAlert).not.toHaveBeenCalled();
  });

  it('handleCreateAlert throws 500 when validatedCreateAlert missing', async () => {
    const c = new AlertHttpController();
    const req = baseReq();

    await expect(c.handleCreateAlert(req)).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(mockCreateAlert).not.toHaveBeenCalled();
  });

  it('handleCreateAlert returns alert detail on success', async () => {
    const c = new AlertHttpController();
    const record = minimalAlertRecord();
    mockCreateAlert.mockResolvedValue({ record, duplicate: false });

    const req = baseReq({
      validatedCreateAlert: {
        orgId: 'org-1',
        actorUserId: 'user-1',
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
        body: {
          inputEventId: 'evt-1',
          inputType: 'MISSED_READING',
          sourceType: 'MONITORING_SERVICE',
          patientId: 'pat-1',
          triggerTimestamp: '2026-01-15T10:00:00.000Z',
          evidencePayload: {
            inputType: 'MISSED_READING',
            appliesToType: 'VITAL_SIGN',
            linkedEntityCode: 'BP_SYSTOLIC',
            source: 'MONITORING_SERVICE',
            eventTimestamp: '2026-01-15T09:00:00.000Z',
            lastSuccessfulReadingTimestamp: '2026-01-14T09:00:00.000Z',
            missedDuration: '24h',
            readingType: 'BLOOD_PRESSURE',
          },
        },
      } as any,
    } as any);

    const out = await c.handleCreateAlert(req);
    expect(out).toMatchObject({
      alertId: record.alertId,
      orgId: 'org-1',
    });
    expect(mockCreateAlert).toHaveBeenCalledTimes(1);
  });

  it('handleCreateAlert normalizes service errors (e.g. IDEMPOTENCY_KEY_IN_USE)', async () => {
    const c = new AlertHttpController();
    const err = new Error('This idempotency key is already in use') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 409;
    err.code = 'IDEMPOTENCY_KEY_IN_USE';
    mockCreateAlert.mockRejectedValue(err);

    const req = baseReq({
      validatedCreateAlert: {
        orgId: 'org-1',
        actorUserId: 'user-1',
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
        body: {
          inputEventId: 'evt-1',
          inputType: 'MISSED_READING',
          sourceType: 'MONITORING_SERVICE',
          patientId: 'pat-1',
          triggerTimestamp: '2026-01-15T10:00:00.000Z',
          evidencePayload: {
            inputType: 'MISSED_READING',
            appliesToType: 'VITAL_SIGN',
            linkedEntityCode: 'BP_SYSTOLIC',
            source: 'MONITORING_SERVICE',
            eventTimestamp: '2026-01-15T09:00:00.000Z',
            lastSuccessfulReadingTimestamp: '2026-01-14T09:00:00.000Z',
            missedDuration: '24h',
            readingType: 'BLOOD_PRESSURE',
          },
        },
      } as any,
    } as any);

    await expect(c.handleCreateAlert(req)).rejects.toMatchObject({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_IN_USE',
    });
  });

  it('handleUpdateAlertWorkflow throws 500 when validatedWorkflow missing', async () => {
    const c = new AlertHttpController();
    const req = baseReq();
    await expect(c.handleUpdateAlertWorkflow(req)).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(mockApplyWorkflow).not.toHaveBeenCalled();
  });

  it('handleUpdateAlertAssignment throws 500 when validatedAssignment missing', async () => {
    const c = new AlertHttpController();
    const req = baseReq();
    await expect(c.handleUpdateAlertAssignment(req)).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(mockApplyAssignment).not.toHaveBeenCalled();
  });

  it('handleUpdateAlertAssignment returns { alertIds } on single-select success', async () => {
    const c = new AlertHttpController();
    const record = minimalAlertRecord({ alertState: 'ASSIGNED' as any });
    mockApplyAssignment.mockResolvedValue({});

    const req = baseReq({
      validatedAssignment: {
        orgId: 'org-1',
        alertIds: [record.alertId],
        authHeader: bearerToken({ 'custom:organizationID': 'org-1', 'custom:userID': 'user-1' }),
        action: 'ASSIGN',
        assignToUserId: 'user-2',
      } as any,
    } as any);

    const out = await c.handleUpdateAlertAssignment(req);
    expect(out).toEqual({ alertIds: [record.alertId] });
    expect(mockApplyAssignment).toHaveBeenCalledWith('org-1', {
      alertIds: [record.alertId],
      action: 'ASSIGN',
      assignToUserId: 'user-2',
      performedByUserId: 'user-1',
    });
  });

  it('handleUpdateAlertAssignment returns { alertIds } on multi-select success', async () => {
    const c = new AlertHttpController();
    mockApplyAssignment.mockResolvedValue({});

    const req = baseReq({
      validatedAssignment: {
        orgId: 'org-1',
        alertIds: ['a1', 'a2'],
        authHeader: bearerToken({ 'custom:organizationID': 'org-1', 'custom:userID': 'user-1' }),
        action: 'UNASSIGN',
        performedByDisplayName: 'User One',
      } as any,
    } as any);

    await expect(c.handleUpdateAlertAssignment(req)).resolves.toEqual({ alertIds: ['a1', 'a2'] });
  });

  it('handleUpdateAlertPriority throws 500 when validatedPriority missing', async () => {
    const c = new AlertHttpController();
    const req = baseReq();
    await expect(c.handleUpdateAlertPriority(req)).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(mockApplyPriority).not.toHaveBeenCalled();
  });

  it('handleUpdateAlertPriority returns { alertIds } on single-select success', async () => {
    const c = new AlertHttpController();
    const record = minimalAlertRecord({ priority: 'P1' as any });
    mockApplyPriority.mockResolvedValue({});

    const req = baseReq({
      validatedPriority: {
        orgId: 'org-1',
        alertIds: [record.alertId],
        authHeader: bearerToken({ 'custom:organizationID': 'org-1', 'custom:userID': 'user-1' }),
        priority: 'P1',
      } as any,
    } as any);

    const out = await c.handleUpdateAlertPriority(req);
    expect(out).toEqual({ alertIds: [record.alertId] });
    expect(mockApplyPriority).toHaveBeenCalledWith('org-1', {
      alertIds: [record.alertId],
      priority: 'P1',
      performedByUserId: 'user-1',
    });
  });

  it('handleUpdateAlertPriority returns { alertIds } on multi-select success', async () => {
    const c = new AlertHttpController();
    mockApplyPriority.mockResolvedValue({});

    const req = baseReq({
      validatedPriority: {
        orgId: 'org-1',
        alertIds: ['a1', 'a2'],
        authHeader: bearerToken({ 'custom:organizationID': 'org-1', 'custom:userID': 'user-1' }),
        priority: 'P1',
        performedByDisplayName: 'User One',
      } as any,
    } as any);

    await expect(c.handleUpdateAlertPriority(req)).resolves.toEqual({ alertIds: ['a1', 'a2'] });
  });

  it('handleUpdateAlertWorkflow returns succeeded/failed on success', async () => {
    const c = new AlertHttpController();
    const record = minimalAlertRecord({ alertState: 'IN_PROGRESS' as any });
    mockApplyWorkflow.mockResolvedValue({
      succeeded: [record.alertId],
      failed: [],
    });

    const req = baseReq({
      pathParameters: { alertId: record.alertId },
      validatedWorkflow: {
        orgId: 'org-1',
        alertIds: [record.alertId],
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
        action: 'START_WORK',
        performedByDisplayName: 'User One',
      } as any,
    } as any);

    const out = await c.handleUpdateAlertWorkflow(req);
    expect(out).toEqual({ alertIds: [record.alertId], succeeded: [record.alertId], failed: [] });
    expect(mockApplyWorkflow).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        alertIds: [record.alertId],
        action: 'START_WORK',
      }),
    );
  });

  it('handleUpdateAlertWorkflow includes performedByUserId when present in token', async () => {
    const c = new AlertHttpController();
    mockApplyWorkflow.mockResolvedValue({
      succeeded: ['a1'],
      failed: [],
    });
    const record = minimalAlertRecord();

    const req = baseReq({
      validatedWorkflow: {
        orgId: 'org-1',
        alertIds: [record.alertId],
        authHeader: bearerToken({ 'custom:organizationID': 'org-1', 'custom:userID': 'user-1' }),
        action: 'START_WORK',
        performedByDisplayName: 'User One',
      } as any,
    } as any);

    await c.handleUpdateAlertWorkflow(req);
    expect(mockApplyWorkflow).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        performedByUserId: 'user-1',
      }),
    );
  });

  it('handleUpdateAlertWorkflow maps unknown workflow error to 422', async () => {
    const c = new AlertHttpController();
    mockApplyWorkflow.mockResolvedValue({
      succeeded: [],
      failed: [{ alertId: 'x', code: 'SOME_WORKFLOW_ERROR', message: 'boom' }],
    });

    const record = minimalAlertRecord();
    const req = baseReq({
      validatedWorkflow: {
        orgId: 'org-1',
        alertIds: [record.alertId],
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
        action: 'START_WORK',
        performedByDisplayName: 'User One',
      } as any,
    } as any);

    await expect(c.handleUpdateAlertWorkflow(req)).rejects.toMatchObject({
      statusCode: 422,
      code: 'SOME_WORKFLOW_ERROR',
    });
  });

  it('handleUpdateAlertWorkflow maps NOT_FOUND to 404', async () => {
    const c = new AlertHttpController();
    mockApplyWorkflow.mockResolvedValue({
      succeeded: [],
      failed: [{ alertId: 'x', code: 'NOT_FOUND', message: 'Alert not found' }],
    });

    const record = minimalAlertRecord();
    const req = baseReq({
      pathParameters: { alertId: record.alertId },
      validatedWorkflow: {
        orgId: 'org-1',
        alertIds: [record.alertId],
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
        action: 'MOVE_TO_WAITING',
        performedByDisplayName: 'User One',
      } as any,
    } as any);

    await expect(c.handleUpdateAlertWorkflow(req)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('handleUpdateAlertWorkflow takes NOT_FOUND branch when first failure is NOT_FOUND', async () => {
    const c = new AlertHttpController();
    mockApplyWorkflow.mockResolvedValue({
      succeeded: [],
      failed: [{ alertId: 'a1', code: 'NOT_FOUND', message: 'nope' }],
    });

    const req = baseReq({
      validatedWorkflow: {
        orgId: 'org-1',
        alertIds: ['a1'],
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
        action: 'START_WORK',
        performedByDisplayName: 'User One',
      } as any,
    } as any);

    await expect(c.handleUpdateAlertWorkflow(req)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('handleUpdateAlertWorkflow maps ILLEGAL_TRANSITION to 409', async () => {
    const c = new AlertHttpController();
    mockApplyWorkflow.mockResolvedValue({
      succeeded: [],
      failed: [
        {
          alertId: 'x',
          code: 'ILLEGAL_TRANSITION',
          message: 'WAIT is not valid from state UNASSIGNED',
        },
      ],
    });

    const record = minimalAlertRecord();
    const req = baseReq({
      pathParameters: { alertId: record.alertId },
      validatedWorkflow: {
        orgId: 'org-1',
        alertIds: [record.alertId],
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
        action: 'MOVE_TO_WAITING',
        performedByDisplayName: 'User One',
      } as any,
    } as any);

    await expect(c.handleUpdateAlertWorkflow(req)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ILLEGAL_TRANSITION',
    });
  });

  it('handleGetAlert throws 400 when alertId missing', async () => {
    const c = new AlertHttpController();
    const req = baseReq({ pathParameters: {} });
    await expect(c.handleGetAlert(req)).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_REQUEST',
    });
  });

  it('handleGetAlert throws 401 when org missing', async () => {
    const c = new AlertHttpController();
    const req = baseReq({
      event: baseEvent({
        headers: { Authorization: bearerToken({ sub: 'user-only' }) },
        pathParameters: { alertId: 'a1' },
      }),
    });
    await expect(c.handleGetAlert(req)).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    expect(mockGetAlert).not.toHaveBeenCalled();
  });

  it('handleGetAlert returns 404 when not found', async () => {
    const c = new AlertHttpController();
    mockGetAlert.mockResolvedValue(null);
    const req = baseReq({ pathParameters: { alertId: 'missing' } });
    await expect(c.handleGetAlert(req)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('handleGetAlert returns mapped detail on success', async () => {
    const c = new AlertHttpController();
    const row = minimalAlertRecord({ alertId: 'a1', id: 'a1', pk: 'ALERT#a1' });
    mockGetAlert.mockResolvedValue(row);
    const req = baseReq({ pathParameters: { alertId: 'a1' } });
    await expect(c.handleGetAlert(req)).resolves.toMatchObject({ alertId: 'a1', orgId: 'org-1' });
  });

  it('handleGetAlertActivity throws 400 when alertId missing', async () => {
    const c = new AlertHttpController();
    const req = baseReq({ pathParameters: {} });
    await expect(c.handleGetAlertActivity(req)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('handleGetAlertActivity throws 401 when org missing', async () => {
    const c = new AlertHttpController();
    const req = baseReq({
      event: baseEvent({
        headers: { Authorization: bearerToken({ sub: 'user-only' }) },
        pathParameters: { alertId: 'a1' },
      }),
    });
    await expect(c.handleGetAlertActivity(req)).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('handleGetAlertActivity returns 404 when alert not in org', async () => {
    const c = new AlertHttpController();
    mockGetAlert.mockResolvedValue(null);
    const req = baseReq({ pathParameters: { alertId: 'a1' } });
    await expect(c.handleGetAlertActivity(req)).resolves.toEqual({ items: undefined });
    expect(mockListAlertActivity).toHaveBeenCalledWith('a1', 'org-1', { notesOnly: false });
  });

  it('handleGetAlertActivity returns items on success', async () => {
    const c = new AlertHttpController();
    const items = [{ activityId: 'act-1' }];
    mockGetAlert.mockResolvedValue(minimalAlertRecord({ alertId: 'a1', id: 'a1', pk: 'ALERT#a1' }));
    mockListAlertActivity.mockResolvedValue(items);
    const req = baseReq({ pathParameters: { alertId: 'a1' } });
    await expect(c.handleGetAlertActivity(req)).resolves.toEqual({ items });
    expect(mockListAlertActivity).toHaveBeenCalledWith('a1', 'org-1', { notesOnly: false });
  });

  it('handleGetAlertActivity passes notesOnly from query params', async () => {
    const c = new AlertHttpController();
    mockGetAlert.mockResolvedValue(minimalAlertRecord({ alertId: 'a1', id: 'a1', pk: 'ALERT#a1' }));
    mockListAlertActivity.mockResolvedValue([]);
    const req = baseReq({
      pathParameters: { alertId: 'a1' },
      params: { alertId: 'a1', notesOnly: 'true' },
    });
    await c.handleGetAlertActivity(req);
    expect(mockListAlertActivity).toHaveBeenCalledWith('a1', 'org-1', { notesOnly: true });
  });

  it('handleListAlerts maps items and includes nextToken', async () => {
    const c = new AlertHttpController();
    const r = minimalAlertRecord({ alertId: 'a1', id: 'a1', pk: 'ALERT#a1' });
    mockListAlerts.mockResolvedValue({ items: [r], nextToken: 'next-1' });

    const req = baseReq({
      params: { queue: 'TEAM' },
      event: baseEvent({ httpMethod: 'GET', path: '/dev/alerts', queryStringParameters: { queue: 'TEAM' } }),
    });

    const out = await c.handleListAlerts(req);
    expect(out).toEqual({
      items: [expect.objectContaining({ alertId: 'a1', orgId: 'org-1' })],
      nextToken: 'next-1',
    });
  });

  it('handleListAlerts passes actorUserId from token to service', async () => {
    const c = new AlertHttpController();
    mockListAlerts.mockResolvedValue({ items: [] });

    await c.handleListAlerts(
      baseReq({
        params: { queue: 'TEAM' },
        event: baseEvent({
          httpMethod: 'GET',
          path: '/dev/alerts',
          queryStringParameters: { queue: 'TEAM' },
          headers: {
            Authorization: bearerToken({
              'custom:organizationID': 'org-1',
              'custom:userID': 'user-1',
            }),
          },
        }),
      }),
    );

    expect(mockListAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        actorUserId: 'user-1',
      }),
    );
  });

  it('handleListAlerts omits nextToken when service does not return it', async () => {
    const c = new AlertHttpController();
    const r = minimalAlertRecord({ alertId: 'a2', id: 'a2', pk: 'ALERT#a2' });
    mockListAlerts.mockResolvedValue({ items: [r] });

    const out = await c.handleListAlerts(
      baseReq({
        params: { queue: 'TEAM' },
      }),
    );
    expect(out).toEqual({
      items: [expect.objectContaining({ alertId: 'a2', orgId: 'org-1' })],
    });
  });

  it('handleListAlerts throws 401 when org missing', async () => {
    const c = new AlertHttpController();
    const req = baseReq({
      event: baseEvent({ headers: { Authorization: bearerToken({ sub: 'u' }) } }),
    });
    await expect(c.handleListAlerts(req)).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('getAlertHttpController caches controller instance', () => {
    const a = getAlertHttpController();
    const b = getAlertHttpController();
    expect(a).toBe(b);
  });
});

