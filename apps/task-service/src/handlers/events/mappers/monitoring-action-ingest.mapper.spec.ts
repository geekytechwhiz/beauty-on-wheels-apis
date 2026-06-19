import { mapIngestPayloadToCreateMonitoringAction } from './monitoring-action-ingest.mapper';
import {
  monitoringActionRequestedSample,
  monitoringActionRequestedStaffSample,
} from '../__tests__/event-test-fixtures';

describe('mapIngestPayloadToCreateMonitoringAction', () => {
  it('maps organizationId and body fields into service payload', () => {
    const result = mapIngestPayloadToCreateMonitoringAction(monitoringActionRequestedSample);

    expect(result).toEqual({
      organizationId: 'org-1',
      patientId: 'pat-1',
      patientDisplayName: 'Jane Doe',
      carePlanInstanceId: 'cp-1',
      monitoringInstanceId: 'mon-1',
      taskBehaviorCode: 'METRIC_CHECKIN',
      assignedToType: 'patient',
      dueWindowStart: monitoringActionRequestedSample.dueWindowStart,
      dueWindowEnd: monitoringActionRequestedSample.dueWindowEnd,
    });
  });

  it('passes optional staff assignment fields', () => {
    const result = mapIngestPayloadToCreateMonitoringAction(monitoringActionRequestedStaffSample);

    expect(result.assignedToStaffId).toBe('staff-1');
    expect(result.assignedToStaffDisplayName).toBe('Staff One');
    expect(result.assignedToType).toBe('orgStaff');
  });
});
