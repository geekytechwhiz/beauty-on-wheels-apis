 
let mockCreateRuntimeTask: jest.Mock;
 
let mockGenerateCarePlanTasks: jest.Mock;
 
let mockCompleteLinkedSourceObject: jest.Mock;

jest.mock('../../bootstrap/event-runtime', () => ({
  configureEventRuntime: jest.fn(),
}));

jest.mock('@api-hub/task-core', () => {
  mockCreateRuntimeTask = jest.fn();
  mockGenerateCarePlanTasks = jest.fn();
  mockCompleteLinkedSourceObject = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      createRuntimeTask: mockCreateRuntimeTask,
      generateCarePlanTasks: mockGenerateCarePlanTasks,
      completeLinkedSourceObject: mockCompleteLinkedSourceObject,
    })),
  };
});

jest.mock('@api-hub/event-platform', () => ({
  onEvent: jest.fn((config: { events: Array<{ handler: (input: unknown) => Promise<void> }> }) =>
    config.events[0].handler.bind(config),
  ),
  TASK_EVENT_OPERATIONS: {
    ON_SERVICE_FLOW_ACTIVATED: 'task-service.onServiceFlowActivated.processed',
    ON_CARE_PLAN_TASK_GENERATION_TRIGGERED: 'task-service.onCarePlanTaskGenerationTriggered.processed',
    ON_LINKED_SOURCE_OBJECT_COMPLETED: 'task-service.onLinkedSourceObjectCompleted.processed',
  },
  defineEvent: (schema: unknown, meta?: unknown) =>
    Object.assign(schema as object, { __meta: meta }),
  configureEventPlatform: jest.fn(),
  EventBridgeAdapter: jest.fn(),
  createDefaultSqsDlqStrategy: jest.fn(),
}));

import { runCarePlanTaskGenerationTriggered } from './carePlanTaskGenerationTriggeredConsumer';
import { handler as carePlanHandler, main as carePlanMain } from './carePlanTaskGenerationTriggeredConsumer';
import { runLinkedSourceObjectCompleted } from './linkedSourceObjectCompletedConsumer';
import { handler as linkedHandler, main as linkedMain } from './linkedSourceObjectCompletedConsumer';
import { runServiceFlowActivated } from './serviceFlowActivatedConsumer';
import { handler as serviceFlowHandler, main as serviceFlowMain } from './serviceFlowActivatedConsumer';

const serviceFlowSample = {
  organizationId: 'org-1',
  patientId: 'pat-1',
  triggerTimestamp: 1780581600000,
  taskPayload: {
    patientDisplayName: 'Jane Doe',
    taskBehaviorCode: 'METRIC_CHECKIN',
    taskDisplayGroup: 'checkIn',
    displayTitle: 'Check in',
    assignedToType: 'patient' as const,
    displayToPatient: true,
  },
};

const carePlanSample = {
  organizationId: 'org-1',
  patientId: 'pat-1',
  patientDisplayName: 'Jane Doe',
  carePlanInstanceId: 'cp-1',
  taskGenerationTrigger: 'stageActivated',
  sourceLinkageContext: {
    linkages: [
      {
        carePlanTaskLinkageId: 'link-1',
        taskBehaviorCode: 'METRIC_CHECKIN',
        taskDisplayGroup: 'checkIn',
        displayTitle: 'Check in',
        assignedToType: 'patient' as const,
        displayToPatient: true,
        dueWindowStart: 1780581600000,
        dueWindowEnd: 1780668000000,
      },
    ],
  },
};

const linkedSourceSample = {
  organizationId: 'org-1',
  patientId: 'pat-1',
  completionSourceType: 'document',
  completionSourceReferenceId: 'doc-1',
  completionEventId: 'evt-1',
  completedAt: 1780581600000,
};

describe('task event consumers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runServiceFlowActivated calls createRuntimeTask', async () => {
    mockCreateRuntimeTask.mockResolvedValue({ record: { runtimeTaskInstanceId: 'rtask-1' } });
    await runServiceFlowActivated(serviceFlowSample);
    expect(mockCreateRuntimeTask).toHaveBeenCalledWith({
      kind: 'serviceFlow',
      organizationId: 'org-1',
      patientId: 'pat-1',
      taskPayload: serviceFlowSample.taskPayload,
    });
  });

  it('runCarePlanTaskGenerationTriggered calls generateCarePlanTasks', async () => {
    mockGenerateCarePlanTasks.mockResolvedValue({ results: [] });
    await runCarePlanTaskGenerationTriggered(carePlanSample);
    expect(mockGenerateCarePlanTasks).toHaveBeenCalledWith(carePlanSample);
  });

  it('runLinkedSourceObjectCompleted calls completeLinkedSourceObject', async () => {
    mockCompleteLinkedSourceObject.mockResolvedValue({ results: [] });
    await runLinkedSourceObjectCompleted(linkedSourceSample);
    expect(mockCompleteLinkedSourceObject).toHaveBeenCalledWith(linkedSourceSample);
  });

  it.each([
    ['serviceFlow', serviceFlowMain, serviceFlowHandler, () => serviceFlowHandler(serviceFlowSample)],
    ['carePlan', carePlanMain, carePlanHandler, () => carePlanHandler(carePlanSample)],
    ['linkedSource', linkedMain, linkedHandler, () => linkedHandler(linkedSourceSample)],
  ])('%s consumer exports main and routes through onEvent handler', async (_label, main, handler, invoke) => {
    expect(main).toBe(handler);
    mockCreateRuntimeTask.mockResolvedValue({ record: { runtimeTaskInstanceId: 'rtask-1' } });
    mockGenerateCarePlanTasks.mockResolvedValue({ results: [] });
    mockCompleteLinkedSourceObject.mockResolvedValue({ results: [] });
    await expect(invoke()).resolves.toBeUndefined();
  });
});
