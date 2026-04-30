import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import type { AlertDdbRecord } from '@api-hub/alert-core';

export function bearerToken(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `Bearer header.${encoded}.signature`;
}

export function testLambdaContext(): Context {
  return {
    awsRequestId: 'test-aws-request-id',
    getRemainingTimeInMillis: () => 30000,
  } as unknown as Context;
}

export function minimalAlertRecord(overrides: Partial<AlertDdbRecord> = {}): AlertDdbRecord {
  const alertId = '8dbe73ff-5964-4b31-b16c-0c046fac501d';
  return {
    TableName: 'alert-service-dev',
    pk: `ALERT#${alertId}`,
    sk: 'METADATA',
    entityType: 'ALERT',
    gsi1pk: 'ORG#org-1',
    gsi1sk: 'STATE#UNASSIGNED#PRIORITY#P2#TS#2026-01-15T10:00:00.000Z#alt',
    gsi3pk: 'PAT#pat-1',
    gsi3sk: 'TS#2026-01-15T10:00:00.000Z',
    gsi4pk: 'GROUP#pat-1|MISSED_READING|OPEN',
    gsi4sk: 'TS#2026-01-15T10:00:00.000Z',
    gsi5pk: 'SLA#2026-01-15',
    gsi5sk: 'SLA#2026-01-15T10:00:00.000Z#alt',
    id: alertId,
    alertId,
    organizationId: 'org-1',
    patientId: 'pat-1',
    inputEventId: 'evt-unique-1',
    inputType: 'MISSED_READING',
    sourceType: 'MONITORING_SERVICE',
    triggerTimestamp: '2026-01-15T10:00:00.000Z',
    triggerSummary: 'No reading',
    evidencePayload: {},
    priority: 'P2',
    alertState: 'UNASSIGNED',
    groupingKey: 'pat-1|MISSED_READING|OPEN',
    assignSlaMinutes: 0,
    resolveSlaMinutes: 0,
    assignSlaDueAt: '2026-01-15T10:00:00.000Z',
    resolveSlaDueAt: '2026-01-15T11:00:00.000Z',
    slaBreachIndicator: false,
    createdAt: '2026-01-15T10:00:01.000Z',
    updatedAt: '2026-01-15T10:00:01.000Z',
    statusUpdatedAt: '2026-01-15T10:00:01.000Z',
    ...overrides,
  } as AlertDdbRecord;
}

export function baseGetEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/dev/alerts/alt-1',
    pathParameters: { alertId: 'alt-1' },
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

export function setupHandlerTestEnv(): { restore: () => void } {
  process.env.ERROR_MESSAGES_CDN_URL =
    process.env.ERROR_MESSAGES_CDN_URL ?? 'https://d2p9v61861q1ox.cloudfront.net';

  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  return {
    restore: () => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    },
  };
}
