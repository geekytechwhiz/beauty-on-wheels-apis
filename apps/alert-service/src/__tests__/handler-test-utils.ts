import type { APIGatewayProxyevent: any, Context } from 'aws-lambda';
import { ALERT_STATE, AlertKeyBuilder, type AlertDdbRecord } from '@api-hub/alert-core';

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
  const trig = Date.parse('2026-01-15T10:00:00.000Z');
  const resolveDue = Date.parse('2026-01-15T11:00:00.000Z');
  const created = Date.parse('2026-01-15T10:00:01.000Z');
  return {
    TableName: 'alert-service-dev',
    pk: `ALERT#${alertId}`,
    sk: 'METADATA',
    entityType: 'ALERT',
    gsi1pk: AlertKeyBuilder.buildGsi1Pk('org-1', ALERT_STATE.UNASSIGNED),
    gsi1sk: AlertKeyBuilder.buildGsi1Sk(trig),
    gsi3pk: 'PAT#pat-1',
    gsi3sk: AlertKeyBuilder.toGsi3Sk(trig),
    gsi4pk: AlertKeyBuilder.buildGsi4Pk('org-1'),
    gsi4sk: AlertKeyBuilder.buildGsi4Sk(trig, alertId),
    gsi5pk: AlertKeyBuilder.toSlaPartitionKey(resolveDue),
    gsi5sk: AlertKeyBuilder.toSlaSortKey(resolveDue, alertId),
    id: alertId,
    alertId,
    organizationId: 'org-1',
    patientId: 'pat-1',
    inputEventId: 'evt-unique-1',
    inputType: 'MISSED_READING',
    sourceType: 'MONITORING_SERVICE',
    triggerTimestamp: trig,
    triggerSummary: 'No reading',
    evidencePayload: {},
    priority: 'P2',
    alertState: ALERT_STATE.UNASSIGNED,
    groupingKey: 'pat-1|MISSED_READING|OPEN',
    assignSlaMinutes: 0,
    resolveSlaMinutes: 0,
    assignSlaDueAt: trig,
    resolveSlaDueAt: resolveDue,
    slaBreachIndicator: false,
    createdAt: created,
    updatedAt: created,
    statusUpdatedAt: created,
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
  process.env.AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
  process.env.ALERT_EVENT_BUS_NAME =
    process.env.ALERT_EVENT_BUS_NAME ?? 'alert-service-bus-dev';

  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  return {
    restore: () => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    },
  };
}
