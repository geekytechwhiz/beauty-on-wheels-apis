// eslint-disable-next-line no-var
var mockCreateAlert: jest.Mock;
// eslint-disable-next-line no-var
var mockPublishAlertIntents: jest.Mock;

jest.mock('../../bootstrap/event-runtime', () => ({
  configureEventRuntime: jest.fn(),
}));

jest.mock('../../publisher/alert-publisher', () => {
  mockPublishAlertIntents = jest.fn().mockResolvedValue(undefined);
  return {
    publishAlertIntents: (...args: unknown[]) => mockPublishAlertIntents(...args),
  };
});

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

jest.mock('@api-hub/event-platform', () => ({
  onEvent: jest.fn(
    (_schema: unknown, fn: (event: { payload: unknown }) => Promise<void>) => fn,
  ),
  publishEvent: jest.fn().mockResolvedValue(undefined),
  defineEvent: (schema: unknown, meta?: unknown) =>
    Object.assign(schema as object, { __meta: meta }),
  configureEventPlatform: jest.fn(),
  EventBridgeAdapter: jest.fn(),
}));

import { minimalAlertRecord } from '../../../../__tests__/handler-test-utils';
import { thresholdBreachPayloadSample } from '../../__tests__/event-test-fixtures';
import { handler, main } from './threshold-breach.consumer';

describe('threshold-breach.consumer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exports main as handler', () => {
    expect(main).toBe(handler);
  });

  it('creates alert and publishes intents when not duplicate', async () => {
    const record = minimalAlertRecord();
    const intents = [{ kind: 'CREATED' as const, record }];
    mockCreateAlert.mockResolvedValue({ record, duplicate: false, publishIntents: intents });

    await handler({ payload: thresholdBreachPayloadSample } as never);

    expect(mockCreateAlert).toHaveBeenCalledTimes(1);
    expect(mockCreateAlert.mock.calls[0][0]).toMatchObject({
      inputType: 'THRESHOLD_BREACH',
      inputEventId: 'threshold-evt-1',
    });
    expect(mockPublishAlertIntents).toHaveBeenCalledWith(intents);
  });

  it('skips publish when create is duplicate', async () => {
    const record = minimalAlertRecord();
    mockCreateAlert.mockResolvedValue({
      record,
      duplicate: true,
      publishIntents: [{ kind: 'CREATED', record }],
    });

    await handler({ payload: thresholdBreachPayloadSample } as never);

    expect(mockCreateAlert).toHaveBeenCalledTimes(1);
    expect(mockPublishAlertIntents).not.toHaveBeenCalled();
  });
});
