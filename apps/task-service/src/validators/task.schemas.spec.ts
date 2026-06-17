import {
  createMonitoringActionHttpBodySchema,
  createRuntimeTaskHttpBodySchema,
  generateCarePlanTasksHttpBodySchema,
  updateAssignedStaffHttpBodySchema,
  updateReminderSettingsHttpBodySchema,
  updateRuntimeTaskHttpBodySchema,
  updateTaskStateHttpBodySchema,
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
      assignedToType: 'patient',
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

  it('accepts valid updateTaskState body with optional evidencePayload', () => {
    const result = updateTaskStateHttpBodySchema.safeParse({
      action: 'complete',
      actorId: 'pat-1',
      actorType: 'patient',
      expectedCurrentState: 'open',
      reason: 'Done',
      evidencePayload: { readingId: 'r-1' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid updateTaskState action', () => {
    const result = updateTaskStateHttpBodySchema.safeParse({
      action: 'archive',
      actorId: 'pat-1',
      actorType: 'patient',
      expectedCurrentState: 'open',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid updateReminderSettings body with camelCase channels', () => {
    const result = updateReminderSettingsHttpBodySchema.safeParse({
      actorId: 'staff-1',
      reminderEnabled: true,
      reminderSettings: { channels: ['push', 'inApp'], quietHoursRespected: true },
      reason: 'Patient requested',
    });
    expect(result.success).toBe(true);
  });

  it('rejects PascalCase reminder channels', () => {
    const result = updateReminderSettingsHttpBodySchema.safeParse({
      actorId: 'staff-1',
      reminderEnabled: true,
      reminderSettings: { channels: ['Push'] },
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid updateRuntimeTask body with at least one mutable field', () => {
    const result = updateRuntimeTaskHttpBodySchema.safeParse({
      actorId: 'staff-1',
      displayTitle: 'Updated title',
      workflowStage: 'ongoing',
    });
    expect(result.success).toBe(true);
  });

  it('rejects updateRuntimeTask body without mutable fields', () => {
    const result = updateRuntimeTaskHttpBodySchema.safeParse({
      actorId: 'staff-1',
      reason: 'noop',
    });
    expect(result.success).toBe(false);
  });

  it('rejects forbidden fields on updateRuntimeTask body', () => {
    const result = updateRuntimeTaskHttpBodySchema.safeParse({
      actorId: 'staff-1',
      displayTitle: 'Updated',
      dueWindowEnd: 1780668000000,
    });
    expect(result.success).toBe(false);
  });
});
