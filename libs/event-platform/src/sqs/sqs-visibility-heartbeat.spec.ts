/**
 * @jest-environment node
 */
import {
  ChangeMessageVisibilityCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

import {
  recordSqsVisibilityHeartbeatLoopEnded,
} from '@api-hub/observability';

import {
  runWithSqsVisibilityHeartbeat,
  SqsVisibilityHeartbeatController,
} from './sqs-visibility-heartbeat';

jest.mock('@api-hub/observability', () => {
  const actual = jest.requireActual('@api-hub/observability');
  return {
    ...actual,
    getLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
    recordSqsVisibilityHeartbeatExtend: jest.fn(),
    recordSqsVisibilityHeartbeatSkipped: jest.fn(),
    recordSqsVisibilityHeartbeatLoopEnded: jest.fn(),
    publishMiddlewarePipelineMetrics: jest.fn(),
  };
});

function mockClient(sendImpl: jest.Mock): SQSClient {
  return { send: sendImpl } as unknown as SQSClient;
}

describe('SqsVisibilityHeartbeatController', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('invokes ChangeMessageVisibility after the first interval', async () => {
    const send = jest.fn().mockResolvedValue({});
    const ctrl = new SqsVisibilityHeartbeatController({
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/q',
      receiptHandle: 'rh-1',
      messageId: 'm1',
      heartbeatIntervalMs: 5_000,
      visibilityExtensionSeconds: 120,
      minRemainingMsToExtend: 1_000,
      minRemainingMsHardStop: 500,
      getRemainingTimeInMillis: () => 300_000,
      client: mockClient(send),
    });
    ctrl.start();
    expect(send).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(7_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeInstanceOf(ChangeMessageVisibilityCommand);
    const cmd = send.mock.calls[0][0] as ChangeMessageVisibilityCommand;
    expect(cmd.input.VisibilityTimeout).toBe(120);
    await ctrl.stop('success');
  });

  it('stop() clears timer and prevents further extensions', async () => {
    const send = jest.fn().mockResolvedValue({});
    const ctrl = new SqsVisibilityHeartbeatController({
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/q',
      receiptHandle: 'rh-1',
      heartbeatIntervalMs: 2_000,
      visibilityExtensionSeconds: 60,
      minRemainingMsToExtend: 500,
      minRemainingMsHardStop: 250,
      getRemainingTimeInMillis: () => 300_000,
      client: mockClient(send),
    });
    ctrl.start();
    // First tick is interval + up to 2s jitter; advance past the worst case.
    await jest.advanceTimersByTimeAsync(2_000 + 2_000);
    expect(send).toHaveBeenCalledTimes(1);
    await ctrl.stop('aborted');
    await jest.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('schedules no SDK work when remaining time is below hard stop', async () => {
    const send = jest.fn().mockResolvedValue({});
    const ctrl = new SqsVisibilityHeartbeatController({
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/q',
      receiptHandle: 'rh-1',
      heartbeatIntervalMs: 1_000,
      visibilityExtensionSeconds: 60,
      minRemainingMsToExtend: 5_000,
      minRemainingMsHardStop: 2_000,
      getRemainingTimeInMillis: () => 1_000,
      client: mockClient(send),
    });
    ctrl.start();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(send).not.toHaveBeenCalled();
    expect(recordSqsVisibilityHeartbeatLoopEnded).toHaveBeenCalled();
    await ctrl.stop('lambda_timeout');
  });
});

describe('runWithSqsVisibilityHeartbeat', () => {
  it('stops heartbeat after fn resolves', async () => {
    jest.useFakeTimers();
    const send = jest.fn().mockResolvedValue({});
    const hooks = { onHeartbeatStopped: jest.fn() };

    const out = await runWithSqsVisibilityHeartbeat(
      {
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/q',
        receiptHandle: 'rh-1',
        heartbeatIntervalMs: 20_000,
        visibilityExtensionSeconds: 90,
        minRemainingMsToExtend: 1_000,
        minRemainingMsHardStop: 500,
        getRemainingTimeInMillis: () => 120_000,
        client: mockClient(send),
        hooks,
      },
      async () => 'done',
    );

    expect(out).toBe('done');
    expect(hooks.onHeartbeatStopped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'success' }),
    );
    jest.useRealTimers();
  });
});
