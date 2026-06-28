 
let mockCreateMonitoringAction: jest.Mock;

jest.mock('../../bootstrap/event-runtime', () => ({
  configureEventRuntime: jest.fn(),
}));

jest.mock('@api-hub/task-core', () => {
  mockCreateMonitoringAction = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      createMonitoringAction: mockCreateMonitoringAction,
    })),
  };
});

jest.mock('@api-hub/event-platform', () => ({
  onEvent: jest.fn((config: { events: Array<{ handler: (input: unknown) => Promise<void> }> }) =>
    config.events[0].handler.bind(config),
  ),
  TASK_EVENT_OPERATIONS: {
    ON_MONITORING_ACTION_REQUESTED: 'task-service.onMonitoringActionRequested.processed',
  },
  defineEvent: (schema: unknown, meta?: unknown) =>
    Object.assign(schema as object, { __meta: meta }),
  configureEventPlatform: jest.fn(),
  EventBridgeAdapter: jest.fn(),
  createDefaultSqsDlqStrategy: jest.fn(),
}));

import { minimalTaskMetaRecord } from '../../../../__tests__/handler-test-utils';
import { monitoringActionRequestedSample } from '../../__tests__/event-test-fixtures';
import { handler, main, runMonitoringActionRequested } from './monitoringActionRequestedConsumer';

describe('monitoringActionRequestedConsumer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateMonitoringAction.mockResolvedValue({ record: minimalTaskMetaRecord(), outcome: 'created' });
  });

  it('exports main as handler', () => {
    expect(main).toBe(handler);
  });

  it('routes onEvent handler to runMonitoringActionRequested', async () => {
    await expect(handler(monitoringActionRequestedSample)).resolves.toBeUndefined();
    expect(mockCreateMonitoringAction).toHaveBeenCalledTimes(1);
  });

  it('creates monitoring task via TaskService', async () => {
    const record = minimalTaskMetaRecord();
    mockCreateMonitoringAction.mockResolvedValue({ record, outcome: 'created' });

    await runMonitoringActionRequested(monitoringActionRequestedSample);

    expect(mockCreateMonitoringAction).toHaveBeenCalledTimes(1);
    expect(mockCreateMonitoringAction.mock.calls[0][0]).toMatchObject({
      organizationId: 'org-1',
      patientId: 'pat-1',
      monitoringInstanceId: 'mon-1',
      taskBehaviorCode: 'METRIC_CHECKIN',
    });
  });

  it('returns skippedDuplicate outcome from service without throwing', async () => {
    const record = minimalTaskMetaRecord();
    mockCreateMonitoringAction.mockResolvedValue({ record, outcome: 'skippedDuplicate' });

    await expect(runMonitoringActionRequested(monitoringActionRequestedSample)).resolves.toBeUndefined();
    expect(mockCreateMonitoringAction).toHaveBeenCalledTimes(1);
  });
});
