// eslint-disable-next-line no-var
var mockRecordReminderCancellation: jest.Mock;

jest.mock('@api-hub/task-core', () => {
  mockRecordReminderCancellation = jest.fn().mockResolvedValue({ written: true });
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      recordReminderCancellation: mockRecordReminderCancellation,
    })),
  };
});

/** Minimal DynamoDB stream attribute shape for stream handler tests. */
type StreamAttributeValue = {
  S?: string;
  N?: string;
  BOOL?: boolean;
  M?: Record<string, StreamAttributeValue>;
  L?: StreamAttributeValue[];
};

import type { LambdaInvocationContext } from '@api-hub/observability';
import type { DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';

import {
  setReminderSchedulerGatewayForTests,
} from '../../reminder/reminder-scheduler.gateway';
import type { ReminderSchedulerGateway } from '../../reminder/reminder-scheduler.types';
import { handler, main } from './cancelReminderJobs';

jest.mock('@api-hub/observability', () => {
  const actual = jest.requireActual('@api-hub/observability');
  return {
    ...actual,
    publishMiddlewarePipelineMetrics: jest.fn(),
  };
});

function streamRecord(overrides: Partial<DynamoDBRecord> = {}): DynamoDBRecord {
  const newImage: Record<string, StreamAttributeValue> = {
    entityType: { S: 'RuntimeTaskInstance' },
    runtimeTaskInstanceId: { S: 'task-1' },
    orgId: { S: 'org-1' },
    patientId: { S: 'pat-1' },
    reminderEnabled: { BOOL: false },
    currentState: { S: 'scheduled' },
  };

  const oldImage: Record<string, StreamAttributeValue> = {
    entityType: { S: 'RuntimeTaskInstance' },
    runtimeTaskInstanceId: { S: 'task-1' },
    reminderEnabled: { BOOL: true },
    currentState: { S: 'scheduled' },
  };

  return {
    eventID: 'eid-cancel-1',
    eventName: 'MODIFY',
    eventVersion: '1.1',
    eventSource: 'aws:dynamodb',
    awsRegion: 'us-east-1',
    eventSourceARN:
      'arn:aws:dynamodb:us-east-1:123456789012:table/task-service-dev/stream/2026-06-05T10:29:35.640',
    dynamodb: {
      Keys: { pk: { S: 'ORG#org-1#PAT#pat-1' }, sk: { S: 'META#task-1' } },
      NewImage: newImage,
      OldImage: oldImage,
      SequenceNumber: '222',
      SizeBytes: 10,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
    ...overrides,
  };
}

const lambdaContext = {
  awsRequestId: 'ddb-req-cancel',
  getRemainingTimeInMillis: () => 300_000,
} satisfies LambdaInvocationContext;

describe('cancelReminderJobs', () => {
  const cancel = jest.fn().mockResolvedValue(undefined);
  const gateway: ReminderSchedulerGateway = { register: jest.fn(), cancel };

  beforeEach(() => {
    jest.clearAllMocks();
    setReminderSchedulerGatewayForTests(gateway);
  });

  afterAll(() => {
    setReminderSchedulerGatewayForTests(undefined);
  });

  it('exports main as handler', () => {
    expect(main).toBe(handler);
  });

  it('cancels reminder schedule when reminders disabled', async () => {
    const event: DynamoDBStreamEvent = { Records: [streamRecord()] };

    const out = await handler(event, lambdaContext);

    expect(out.batchItemFailures).toEqual([]);
    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeTaskInstanceId: 'task-1',
        reason: 'remindersDisabled',
      }),
    );
  });
});
