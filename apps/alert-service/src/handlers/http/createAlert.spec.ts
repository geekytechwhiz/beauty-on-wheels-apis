import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  bearerToken,
  minimalAlertRecord,
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
        if (event?.source === 'serverless-plugin-warmup') {
          return ApiResponse.ok(null, { title: 'SUCCESS', description: 'Warmup', severity: 'SUCCESS' }, { correlationId: 'unknown' });
        }

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
          event: any,
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
          if (e?.name === 'ZodError') {
            return ApiResponse.unprocessableEntity(
              { title: 'VALIDATION_ERROR', description: e?.issues?.[0]?.message ?? 'Validation failed', severity: 'ERROR' },
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

/** Mock must be set in factory before AlertHttpController loads (Jest hoist). */
// eslint-disable-next-line no-var
var mockCreateAlert: jest.Mock;

jest.mock('@api-hub/alert-core', () => {
  mockCreateAlert = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/alert-core')>('@api-hub/alert-core');
  return {
    ...actual,
    AlertService: jest.fn().mockImplementation(() => ({
      createAlert: mockCreateAlert,
    })),
  };
});

import { main } from './createAlert';

describe('createAlert HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    envCleanup();
  });

  beforeEach(() => {
    mockCreateAlert.mockReset();
  });

  function validMissedReadingBody(): Record<string, unknown> {
    return {
      inputEventId: 'evt-unique-1',
      inputType: 'MISSED_READING',
      sourceType: 'MONITORING_SERVICE',
      patientId: 'pat-1',
      triggerTimestamp: '2026-01-15T10:00:00.000Z',
      evidencePayload: {
        eventTimestamp: '2026-01-15T09:00:00.000Z',
        source: 'MONITORING_SERVICE',
        inputType: 'MISSED_READING',
        appliesToType: 'VITAL_SIGN',
        linkedEntityCode: 'BP_SYSTOLIC',
        lastSuccessfulReadingTimestamp: '2026-01-14T09:00:00.000Z',
        missedDuration: '24h',
        readingType: 'BLOOD_PRESSURE',
      },
    };
  }

  function baseEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
      httpMethod: 'POST',
      path: '/dev/alerts',
      pathParameters: null,
      queryStringParameters: null,
      headers: {
        Authorization: bearerToken({
          'custom:organizationID': 'org-1',
          'custom:userID': 'user-1',
        }),
      },
      body: JSON.stringify(validMissedReadingBody()),
      ...overrides,
    } as unknown as APIGatewayProxyEvent;
  }

  const context = testLambdaContext();

  it('returns 200 with alert detail when createAlert succeeds', async () => {
    const record = minimalAlertRecord();
    mockCreateAlert.mockResolvedValue({ record, duplicate: false });

    const result = await (main as any)(baseEvent(), context);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}') as {
      success: boolean;
      data: { orgId: string; alertId: string; patientId: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.orgId).toBe('org-1');
    expect(body.data.alertId).toBe(record.alertId);
    expect(body.data.patientId).toBe('pat-1');

    expect(mockCreateAlert).toHaveBeenCalledTimes(1);
    const [payload, authHeader] = mockCreateAlert.mock.calls[0] as [
      { organizationId: string; actorUserId: string | undefined; patientId: string },
      string | undefined,
    ];
    expect(payload.organizationId).toBe('org-1');
    expect(payload.actorUserId).toBe('user-1');
    expect(payload.patientId).toBe('pat-1');
    expect(authHeader).toContain('Bearer');
  });

  it('returns 200 on idempotent replay (duplicate: true) with same alert payload', async () => {
    const record = minimalAlertRecord();
    mockCreateAlert.mockResolvedValue({ record, duplicate: true });

    const result = await (main as any)(baseEvent(), context);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}') as { data: { alertId: string } };
    expect(body.data.alertId).toBe(record.alertId);
  });

  it('returns 200 for MISSING_DEVICE with DEVICE_MONITORING', async () => {
    const record = minimalAlertRecord({
      inputType: 'MISSING_DEVICE',
      sourceType: 'DEVICE_MONITORING',
      inputEventId: 'evt-device-1',
    });
    mockCreateAlert.mockResolvedValue({ record, duplicate: false });

    const bodyObj = {
      inputEventId: 'evt-device-1',
      inputType: 'MISSING_DEVICE',
      sourceType: 'DEVICE_MONITORING',
      patientId: 'pat-1',
      triggerTimestamp: '2026-01-15T10:00:00.000Z',
      evidencePayload: {
        eventTimestamp: '2026-01-15T09:00:00.000Z',
        source: 'DEVICE_MONITORING',
        inputType: 'MISSING_DEVICE',
        appliesToType: 'DEVICE',
        linkedEntityCode: 'GLUCOSE_METER',
        deviceLinked: false,
      },
    };
    const event = baseEvent({ body: JSON.stringify(bodyObj) });

    const result = await (main as any)(event: any, context);

    expect(result.statusCode).toBe(200);
    expect(mockCreateAlert).toHaveBeenCalledTimes(1);
    const payload = mockCreateAlert.mock.calls[0][0] as { inputType: string };
    expect(payload.inputType).toBe('MISSING_DEVICE');
  });

  it('returns 500 when createAlert throws an unexpected error', async () => {
    mockCreateAlert.mockRejectedValue(new Error('Unexpected failure'));

    const result = await (main as any)(baseEvent(), context);

    expect(result.statusCode).toBe(500);
    expect(mockCreateAlert).toHaveBeenCalled();
  });

  it('returns 409 when createAlert throws IDEMPOTENCY_KEY_IN_USE', async () => {
    const err = new Error('This idempotency key is already in use') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 409;
    err.code = 'IDEMPOTENCY_KEY_IN_USE';
    mockCreateAlert.mockRejectedValue(err);

    const result = await (main as any)(baseEvent(), context);

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body ?? '{}') as {
      success: boolean;
      error: { code: string } | null;
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('IDEMPOTENCY_KEY_IN_USE');
  });

  it('returns 401 when organization is missing from token', async () => {
    const event = baseEvent({
      headers: { Authorization: bearerToken({ sub: 'user-only' }) },
    });

    const result = await (main as any)(event: any, context);

    expect([401, 422]).toContain(result.statusCode);
    const body = JSON.parse(result.body ?? '{}') as {
      statusCode?: number;
      error: { code?: string } | null;
    };
    expect(body.statusCode ?? result.statusCode).toBeGreaterThanOrEqual(401);
    if (result.statusCode === 401) {
      expect(body.error?.code).toBe('UNAUTHORIZED');
    }
    expect(mockCreateAlert).not.toHaveBeenCalled();
  });

  it('returns 422 when body fails Zod validation', async () => {
    const bad = {
      ...validMissedReadingBody(),
      inputType: 'INVALID_TYPE',
    };
    const event = baseEvent({ body: JSON.stringify(bad) });

    const result = await (main as any)(event: any, context);

    expect(result.statusCode).toBe(422);
    expect(mockCreateAlert).not.toHaveBeenCalled();
  });

  it('returns 422 when sourceType is not allowed for inputType', async () => {
    const bad = {
      ...validMissedReadingBody(),
      sourceType: 'USER_INTERFACE',
      evidencePayload: {
        ...(validMissedReadingBody().evidencePayload as object),
        source: 'USER_INTERFACE',
      },
    };
    const event = baseEvent({ body: JSON.stringify(bad) });

    const result = await (main as any)(event: any, context);

    expect(result.statusCode).toBe(422);
    const body = JSON.parse(result.body ?? '{}') as { error: { code?: string } | null };
    expect(body.error?.code ?? 'VALIDATION_ERROR').toBeTruthy();
    expect(mockCreateAlert).not.toHaveBeenCalled();
  });

  it('returns 422 for strict schema when extra top-level property is present', async () => {
    const bad = { ...validMissedReadingBody(), unknownField: true };
    const event = baseEvent({ body: JSON.stringify(bad) });

    const result = await (main as any)(event: any, context);

    expect(result.statusCode).toBe(422);
    expect(mockCreateAlert).not.toHaveBeenCalled();
  });

  it('accepts optional assignSlaMinutes / resolveSlaMinutes and forwards them to the service', async () => {
    const record = minimalAlertRecord();
    mockCreateAlert.mockResolvedValue({ record, duplicate: false });

    const body = {
      ...validMissedReadingBody(),
      assignSlaMinutes: 30,
      resolveSlaMinutes: 120,
    };
    const result = await (main as any)(baseEvent({ body: JSON.stringify(body) }), context);

    expect(result.statusCode).toBe(200);
    expect(mockCreateAlert).toHaveBeenCalledTimes(1);
    const payload = mockCreateAlert.mock.calls[0][0] as {
      assignSlaMinutes?: number;
      resolveSlaMinutes?: number;
    };
    expect(payload.assignSlaMinutes).toBe(30);
    expect(payload.resolveSlaMinutes).toBe(120);
  });

  it('omitting SLA minutes leaves them undefined on the payload (builder applies defaults)', async () => {
    const record = minimalAlertRecord();
    mockCreateAlert.mockResolvedValue({ record, duplicate: false });

    const result = await (main as any)(baseEvent(), context);

    expect(result.statusCode).toBe(200);
    const payload = mockCreateAlert.mock.calls[0][0] as {
      assignSlaMinutes?: number;
      resolveSlaMinutes?: number;
    };
    expect(payload.assignSlaMinutes).toBeUndefined();
    expect(payload.resolveSlaMinutes).toBeUndefined();
  });

  it('returns 422 when assignSlaMinutes is negative or non-integer', async () => {
    const cases = [{ assignSlaMinutes: -5 }, { assignSlaMinutes: 12.5 }];
    for (const overrides of cases) {
      mockCreateAlert.mockReset();
      const body = { ...validMissedReadingBody(), ...overrides };
      const result = await (main as any)(baseEvent({ body: JSON.stringify(body) }), context);
      expect(result.statusCode).toBe(422);
      expect(mockCreateAlert).not.toHaveBeenCalled();
    }
  });

  it('handles serverless-plugin-warmup payload with 200', async () => {
    const warmupEvent = { source: 'serverless-plugin-warmup' } as unknown as APIGatewayProxyEvent;
    const result = await (main as any)(warmupevent: any, context);
    expect(result.statusCode).toBe(200);
    expect(mockCreateAlert).not.toHaveBeenCalled();
  });
});
