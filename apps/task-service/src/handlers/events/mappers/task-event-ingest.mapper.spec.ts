import {
  mapIngestPayloadToCreateRuntimeTask,
  mapIngestPayloadToGenerateCarePlanTasks,
} from './task-event-ingest.mapper';

describe('task-event-ingest.mapper', () => {
  it('maps ServiceFlowActivated to createRuntimeTask payload', () => {
    const result = mapIngestPayloadToCreateRuntimeTask({
      organizationId: 'org-1',
      patientId: 'pat-1',
      triggerTimestamp: 1780581600000,
      taskPayload: {
        patientDisplayName: 'Jane Doe',
        taskBehaviorCode: 'METRIC_CHECKIN',
        taskDisplayGroup: 'checkIn',
        displayTitle: 'Check in',
        assignedToType: 'patient',
        displayToPatient: true,
      },
    });

    expect(result).toMatchObject({
      organizationId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskSource: 'serviceFlowRuntime',
      createdBy: 'system:service-flow-runtime',
      taskBehaviorCode: 'METRIC_CHECKIN',
    });
  });

  it('maps CarePlanTaskGenerationTriggered to generateCarePlanTasks payload', () => {
    const result = mapIngestPayloadToGenerateCarePlanTasks({
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

    expect(result.organizationId).toBe('org-1');
    expect(result.createdBy).toBe('system:care-plan-runtime:actor-1');
    expect(result.linkages).toHaveLength(1);
  });
});
