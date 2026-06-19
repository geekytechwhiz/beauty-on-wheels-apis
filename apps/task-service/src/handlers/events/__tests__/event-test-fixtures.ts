import { minimalTaskMetaRecord } from '../../../__tests__/handler-test-utils';

export { minimalTaskMetaRecord };

export const monitoringActionRequestedSample = {
  organizationId: 'org-1',
  patientId: 'pat-1',
  patientDisplayName: 'Jane Doe',
  carePlanInstanceId: 'cp-1',
  monitoringInstanceId: 'mon-1',
  taskBehaviorCode: 'METRIC_CHECKIN',
  assignedToType: 'patient' as const,
  dueWindowStart: Date.parse('2026-06-05T08:00:00.000Z'),
  dueWindowEnd: Date.parse('2026-06-06T08:00:00.000Z'),
};

export const monitoringActionRequestedStaffSample = {
  ...monitoringActionRequestedSample,
  assignedToType: 'orgStaff' as const,
  assignedToStaffId: 'staff-1',
  assignedToStaffDisplayName: 'Staff One',
};
