import { ALERT_STATE } from '../models/types/alert-state.type';
import { AlertWorkflowAction } from '../constants/alert-workflow-action';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import { workflowActionToUpdatePatch } from './alert-workflow';

function minimalRow(overrides: Partial<AlertDdbRecord> = {}): AlertDdbRecord {
  return {
    pk: 'ALERT#a',
    sk: 'METADATA',
    entityType: 'ALERT',
    alertId: 'a',
    organizationId: 'org-1',
    patientId: 'pat-1',
    inputEventId: 'evt-1',
    inputType: 'MISSED_READING',
    sourceType: 'MONITORING_SERVICE',
    triggerTimestamp: Date.now(),
    triggerSummary: 't',
    evidencePayload: {},
    priority: 'P2',
    alertState: ALERT_STATE.UNASSIGNED,
    groupingKey: 'g1',
    assignSlaMinutes: 60,
    resolveSlaMinutes: 240,
    assignSlaDueAt: Date.now(),
    resolveSlaDueAt: Date.now(),
    slaBreachIndicator: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    statusUpdatedAt: Date.now(),
    ...overrides,
  } as AlertDdbRecord;
}

describe('alert-workflow', () => {
  describe('ASSIGN', () => {
    it('UNASSIGNED -> ASSIGNED', () => {
      const row = minimalRow({ alertState: ALERT_STATE.UNASSIGNED });
      const patch = workflowActionToUpdatePatch(row, AlertWorkflowAction.Assign, {
        assignToUserId: 'user-1',
        assignedToDisplayName: 'User One',
      });
      expect(patch).toEqual({
        alertState: ALERT_STATE.ASSIGNED,
        assignedToUserId: 'user-1',
        assignedToDisplayName: 'User One',
      });
    });

    it('ASSIGNED -> ASSIGNED (reassignment)', () => {
      const row = minimalRow({ alertState: ALERT_STATE.ASSIGNED, assignedToUserId: 'user-old' });
      const patch = workflowActionToUpdatePatch(row, AlertWorkflowAction.Assign, {
        assignToUserId: 'user-new',
        assignedToDisplayName: 'User New',
      });
      expect(patch).toEqual({
        alertState: ALERT_STATE.ASSIGNED,
        assignedToUserId: 'user-new',
        assignedToDisplayName: 'User New',
      });
    });

    it('rejects IN_PROGRESS', () => {
      const row = minimalRow({ alertState: ALERT_STATE.IN_PROGRESS });
      expect(() =>
        workflowActionToUpdatePatch(row, AlertWorkflowAction.Assign, {
          assignToUserId: 'user-1',
          assignedToDisplayName: 'User One',
        }),
      ).toMatchObject({ statusCode: 409, code: 'ILLEGAL_TRANSITION' });
    });
  });

  describe('START_WORK', () => {
    it('ASSIGNED -> IN_PROGRESS', () => {
      const row = minimalRow({ alertState: ALERT_STATE.ASSIGNED });
      const patch = workflowActionToUpdatePatch(row, AlertWorkflowAction.StartWork, {});
      expect(patch).toEqual({ alertState: ALERT_STATE.IN_PROGRESS });
    });

    it('rejects UNASSIGNED', () => {
      const row = minimalRow({ alertState: ALERT_STATE.UNASSIGNED });
      expect(() => workflowActionToUpdatePatch(row, AlertWorkflowAction.StartWork, {})).toMatchObject({
        statusCode: 409,
        code: 'ILLEGAL_TRANSITION',
      });
    });
  });

  describe('RESOLVE', () => {
    it('rejects UNASSIGNED', () => {
      const row = minimalRow({ alertState: ALERT_STATE.UNASSIGNED });
      expect(() =>
        workflowActionToUpdatePatch(row, AlertWorkflowAction.Resolve, { resolutionCode: 'X' }),
      ).toMatchObject({ statusCode: 409, code: 'ILLEGAL_TRANSITION' });
    });
  });

  describe('terminal states', () => {
    it('rejects transitions from RESOLVED', () => {
      const row = minimalRow({ alertState: ALERT_STATE.RESOLVED });
      expect(() => workflowActionToUpdatePatch(row, AlertWorkflowAction.Dismiss, {})).toMatchObject({
        statusCode: 409,
        code: 'ILLEGAL_TRANSITION',
      });
    });
  });
});

