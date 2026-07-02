import type { TaskRepository } from '../repositories/task-repository';

import { TaskService } from './task.service';

describe('TaskService HTTP and event input normalization', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;

  it('createRuntimeTask maps HTTP input into repository payload', async () => {
    const repo = {
      createRuntimeTask: jest.fn().mockResolvedValue({}),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    await svc.createRuntimeTask({
      kind: 'http',
      organizationId: 'org-1',
      createdBy: 'user:user-1',
      body: {
        patientId: 'pat-1',
        patientDisplayName: 'Jane Doe',
        runtimeTaskSource: 'manualSystem',
        taskBehaviorCode: 'CARE_TEAM_TASK',
        taskDisplayGroup: 'staffTask',
        displayTitle: 'Call patient',
        assignedToType: 'orgStaff',
        assignedToStaffId: 'staff-1',
        assignedToStaffDisplayName: 'Nurse One',
        displayToPatient: false,
      },
    });

    expect(repo.createRuntimeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        createdBy: 'user:user-1',
        patientId: 'pat-1',
      }),
    );
  });

  it('createRuntimeTask maps service-flow event input into repository payload', async () => {
    const repo = {
      createRuntimeTask: jest.fn().mockResolvedValue({}),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    await svc.createRuntimeTask({
      kind: 'serviceFlow',
      organizationId: 'org-1',
      patientId: 'pat-1',
      taskPayload: {
        patientDisplayName: 'Jane Doe',
        taskBehaviorCode: 'METRIC_CHECKIN',
        taskDisplayGroup: 'checkIn',
        displayTitle: 'Check in',
        assignedToType: 'patient',
        displayToPatient: true,
      },
    });

    expect(repo.createRuntimeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        patientId: 'pat-1',
        runtimeTaskSource: 'serviceFlowRuntime',
        createdBy: 'system:service-flow-runtime',
        taskBehaviorCode: 'METRIC_CHECKIN',
      }),
    );
  });

  it('generateCarePlanTasks maps actorId into createdBy', async () => {
    const repo = {
      buildCarePlanTaskKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-abc',
        generationHash: 'hash',
      }),
      resolveCarePlanNaturalKey: jest.fn().mockResolvedValue('missing'),
      createCarePlanTask: jest.fn().mockResolvedValue({ runtimeTaskInstanceId: 'rtask-abc' }),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    await svc.generateCarePlanTasks({
      organizationId: 'org-1',
      patientId: 'pat-1',
      patientDisplayName: 'Jane Doe',
      carePlanInstanceId: 'cp-1',
      taskGenerationTrigger: 'stageActivated',
      actorId: 'actor-1',
      sourceLinkageContext: {
        linkages: [
          {
            carePlanTaskLinkageId: 'link-1',
            taskBehaviorCode: 'METRIC_CHECKIN',
            taskDisplayGroup: 'checkIn',
            displayTitle: 'Check in',
            assignedToType: 'patient',
            displayToPatient: true,
            dueWindowStart: 1780581600000,
            dueWindowEnd: 1780668000000,
          },
        ],
      },
    });

    expect(repo.createCarePlanTask).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        createdBy: 'system:care-plan-runtime:actor-1',
      }),
    );
  });
});
