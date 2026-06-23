// eslint-disable-next-line no-var
var mockRecordReminderRegistration: jest.Mock;

jest.mock('@api-hub/task-core', () => {
  mockRecordReminderRegistration = jest.fn().mockResolvedValue({ written: true });
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      recordReminderRegistration: mockRecordReminderRegistration,
    })),
  };
});

import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { LambdaInvocationContext } from '@api-hub/observability';
import type { DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';

import {
  setReminderSchedulerGatewayForTests,
} from '../../reminder/reminder-scheduler.gateway';
import type { ReminderSchedulerGateway } from '../../reminder/reminder-scheduler.types';
import {
  setQuietHoursProviderForTests,
  type QuietHoursProvider,
} from '../../reminder/quiet-hours.provider';
import { handler, main } from './registerReminderJobs';

jest.mock('@api-hub/observability', () => {
  const actual = jest.requireActual('@api-hub/observability');
  return {
    ...actual,
    publishMiddlewarePipelineMetrics: jest.fn(),
  };
});

function streamRecord(overrides: Partial<DynamoDBRecord> = {}): DynamoDBRecord {
  const newImage: Record<string, AttributeValue> = {
    entityType: { S: 'RuntimeTaskInstance' },
    runtimeTaskInstanceId: { S: 'task-1' },
    orgId: { S: 'org-1' },
    patientId: { S: 'pat-1' },
    reminderEnabled: { BOOL: true },
    currentState: { S: 'open' },
    dueWindowEnd: { N: '1700000360000' },
    reminderSettings: {
      M: {
        channels: { L: [{ S: 'push' }] },
      },
    },
  };

  return {
    eventID: 'eid-register-1',
    eventName: 'INSERT',
    eventVersion: '1.1',
    eventSource: 'aws:dynamodb',
    awsRegion: 'us-east-1',
    eventSourceARN:
      'arn:aws:dynamodb:us-east-1:123456789012:table/task-service-dev/stream/2026-06-05T10:29:35.640',
    dynamodb: {
      Keys: { pk: { S: 'ORG#org-1#PAT#pat-1' }, sk: { S: 'META#task-1' } },
      NewImage: newImage,
      SequenceNumber: '111',
      SizeBytes: 10,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
    ...overrides,
  };
}

const lambdaContext = {
  awsRequestId: 'ddb-req-register',
  getRemainingTimeInMillis: () => 300_000,
} satisfies LambdaInvocationContext;

const nullQuietHoursProvider: QuietHoursProvider = {
  getForPatient: jest.fn().mockResolvedValue(null),
};

describe('registerReminderJobs', () => {
  const register = jest.fn().mockResolvedValue({
    outcome: 'created',
    schedulerJobId: 'task-reminder-task-1',
    scheduledAt: 1_700_000_360_000,
  });
  const gateway: ReminderSchedulerGateway = { register, cancel: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    setReminderSchedulerGatewayForTests(gateway);
    setQuietHoursProviderForTests(nullQuietHoursProvider);
  });

  afterAll(() => {
    setReminderSchedulerGatewayForTests(undefined);
    setQuietHoursProviderForTests(undefined);
  });

  it('exports main as handler', () => {
    expect(main).toBe(handler);
  });

  it('registers reminder schedule for eligible INSERT', async () => {
    const event: DynamoDBStreamEvent = { Records: [streamRecord()] };

    const out = await handler(event, lambdaContext);

    expect(out.batchItemFailures).toEqual([]);
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeTaskInstanceId: 'task-1',
        patientId: 'pat-1',
        orgId: 'org-1',
        scheduledAt: 1_700_000_360_000,
        channel: 'push',
      }),
    );
    expect(mockRecordReminderRegistration).toHaveBeenCalledWith({
      runtimeTaskInstanceId: 'task-1',
      scheduledAt: 1_700_000_360_000,
      channel: 'push',
      schedulerJobId: 'task-reminder-task-1',
      correlationId: 'eid-register-1',
    });
  });
});
