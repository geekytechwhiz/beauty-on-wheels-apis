import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { TaskKeyBuilder, type TaskMetaDdbRecord } from '@api-hub/task-core';

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

export function minimalTaskMetaRecord(overrides: Partial<TaskMetaDdbRecord> = {}): TaskMetaDdbRecord {
  const runtimeTaskInstanceId = 'rtask-test-001';
  const dueWindowStart = Date.parse('2026-06-05T08:00:00.000Z');
  const dueWindowEnd = Date.parse('2026-06-06T08:00:00.000Z');
  const created = Date.parse('2026-06-05T07:00:00.000Z');
  const metaSk = TaskKeyBuilder.buildMetaSk(dueWindowStart, dueWindowEnd, runtimeTaskInstanceId);

  return {
    pk: TaskKeyBuilder.buildPatientPartitionKey('org-1', 'pat-1'),
    sk: metaSk,
    entityType: 'RuntimeTaskInstance',
    orgId: 'org-1',
    patientId: 'pat-1',
    runtimeTaskInstanceId,
    runtimeTaskSource: 'monitoringRuntime',
    carePlanInstanceId: 'cp-1',
    monitoringInstanceId: 'mon-1',
    taskBehaviorCode: 'METRIC_CHECKIN',
    taskDisplayGroup: 'checkIn',
    displayTitle: 'Record your health metrics',
    assignedToType: 'patient',
    displayToPatient: true,
    currentState: 'active',
    dueWindowStart,
    dueWindowEnd,
    reminderEnabled: true,
    lsi1Sk: TaskKeyBuilder.buildLsi1Sk('cp-1', runtimeTaskInstanceId),
    createdAt: created,
    createdBy: 'system:monitoring-runtime',
    lastUpdatedAt: created,
    lastUpdatedBy: 'system:monitoring-runtime',
    version: 1,
    ...overrides,
  };
}

export function basePostEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/dev/tasks/monitoring-action',
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

export function setupHandlerTestEnv(): { restore: () => void } {
  process.env.ERROR_MESSAGES_CDN_URL =
    process.env.ERROR_MESSAGES_CDN_URL ?? 'https://d2p9v61861q1ox.cloudfront.net';
  process.env.AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
  process.env.TASK_TABLE = process.env.TASK_TABLE ?? 'task-service-dev';

  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  return {
    restore: () => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    },
  };
}
