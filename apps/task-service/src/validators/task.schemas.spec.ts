import {
  createMonitoringActionHttpBodySchema,
  createRuntimeTaskHttpBodySchema,
  generateCarePlanTasksHttpBodySchema,
  updateAssignedStaffHttpBodySchema,
} from './task.schemas';

const CP_DUE_START = 1780567200000;
const CP_DUE_END = 1780610400000;

describe('task.schemas', () => {
  it('rejects wrong types on createMonitoringAction', () => {
    const result = createMonitoringActionHttpBodySchema.safeParse({
      patientId: 'pat-1',
      patientDisplayName: 'Maria Lopez',
      carePlanInstanceId: 'cp-1',
      monitoringInstanceId: 'mon-1',
      taskBehaviorCode: 'METRIC_CHECKIN',
      dueWindowStart: 'not-a-number',
      dueWindowEnd: CP_DUE_END,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields on generateCarePlanTasks', () => {
    const result = generateCarePlanTasksHttpBodySchema.safeParse({
      patientId: 'pat-1',
      carePlanInstanceId: 'cp-1',
      taskGenerationTrigger: 'carePlanStageEntered',
      sourceLinkageContext: {
        linkages: [
          {
            carePlanTaskLinkageId: 'link-1',
            taskBehaviorCode: 'EDUCATION_VIDEO',
            taskDisplayGroup: 'learning',
            displayTitle: 'Watch video',
            assignedToType: 'patient',
            displayToPatient: true,
            dueWindowStart: CP_DUE_START,
            dueWindowEnd: CP_DUE_END,
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid createRuntimeTask body', () => {
    const result = createRuntimeTaskHttpBodySchema.safeParse({
      patientId: 'pat-1',
      patientDisplayName: 'Maria Lopez',
      runtimeTaskSource: 'manualSystem',
      taskBehaviorCode: 'INSTRUCTION',
      taskDisplayGroup: 'action',
      displayTitle: 'Task',
      assignedToType: 'patient',
      displayToPatient: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown keys (strict)', () => {
    const result = updateAssignedStaffHttpBodySchema.safeParse({
      actorId: 'staff-manager-1',
      assignedToStaffId: 'staff-2',
      assignedToStaffDisplayName: 'Nurse Two',
      extraField: true,
    });
    expect(result.success).toBe(false);
  });
});
