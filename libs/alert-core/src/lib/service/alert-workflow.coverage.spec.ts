import { ALERT_STATE } from '../models/types/alert-state.type';
import { AlertWorkflowAction } from '../constants/alert-workflow-action';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import {
  assertWorkflowClosureComment,
  workflowActionToUpdatePatch,
} from './alert-workflow';

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

describe('alert-workflow (coverage)', () => {
  describe('assertWorkflowClosureComment', () => {
    it('no-ops for non terminal closure actions', () => {
      expect(() => assertWorkflowClosureComment(AlertWorkflowAction.StartWork, undefined, undefined)).not.toThrow();
    });

    it('throws 422 when RESOLVE missing reason code', () => {
      expect(() => assertWorkflowClosureComment(AlertWorkflowAction.Resolve, 'x', undefined, {})).toThrow(
        expect.objectContaining({ statusCode: 422, code: 'MISSING_REASON_CODE' }),
      );
    });

    it('throws 422 when DISMISS missing reason code', () => {
      expect(() => assertWorkflowClosureComment(AlertWorkflowAction.Dismiss, 'x', undefined, {})).toThrow(
        expect.objectContaining({ statusCode: 422, code: 'MISSING_REASON_CODE' }),
      );
    });

    it('throws 422 when OTHER without closureComment or comment', () => {
      expect(() =>
        assertWorkflowClosureComment(AlertWorkflowAction.Resolve, undefined, undefined, { resolutionCode: 'OTHER' }),
      ).toThrow(expect.objectContaining({ statusCode: 422, code: 'OTHER_REQUIRES_COMMENT' }));
    });
  });

  describe('workflowActionToUpdatePatch', () => {
    it('ASSIGN validates assignee and display name', () => {
      const row = minimalRow({ alertState: ALERT_STATE.UNASSIGNED });
      expect(() =>
        workflowActionToUpdatePatch(row, AlertWorkflowAction.Assign, { assignedToDisplayName: 'X' }),
      ).toThrow(expect.objectContaining({ statusCode: 422, code: 'MISSING_ASSIGNEE' }));
      expect(() =>
        workflowActionToUpdatePatch(row, AlertWorkflowAction.Assign, { assignToUserId: 'u1' }),
      ).toThrow(expect.objectContaining({ statusCode: 422, code: 'MISSING_ASSIGNEE_DISPLAY_NAME' }));
    });

    it('MOVE_TO_WAITING supports ASSIGNED and IN_PROGRESS only', () => {
      const assigned = minimalRow({ alertState: ALERT_STATE.ASSIGNED });
      expect(workflowActionToUpdatePatch(assigned, AlertWorkflowAction.MoveToWaiting, {})).toEqual({
        alertState: ALERT_STATE.WAITING,
      });
      const inProgress = minimalRow({ alertState: ALERT_STATE.IN_PROGRESS });
      expect(workflowActionToUpdatePatch(inProgress, AlertWorkflowAction.MoveToWaiting, {})).toEqual({
        alertState: ALERT_STATE.WAITING,
      });
      const unassigned = minimalRow({ alertState: ALERT_STATE.UNASSIGNED });
      expect(() => workflowActionToUpdatePatch(unassigned, AlertWorkflowAction.MoveToWaiting, {})).toThrow(
        expect.objectContaining({ statusCode: 409, code: 'ILLEGAL_TRANSITION' }),
      );
    });

    it('RESUME_WORK only from WAITING', () => {
      const waiting = minimalRow({ alertState: ALERT_STATE.WAITING });
      expect(workflowActionToUpdatePatch(waiting, AlertWorkflowAction.ResumeWork, {})).toEqual({
        alertState: ALERT_STATE.IN_PROGRESS,
      });
      const assigned = minimalRow({ alertState: ALERT_STATE.ASSIGNED });
      expect(() => workflowActionToUpdatePatch(assigned, AlertWorkflowAction.ResumeWork, {})).toThrow(
        expect.objectContaining({ statusCode: 409, code: 'ILLEGAL_TRANSITION' }),
      );
    });

    it('RESOLVE includes resolutionCode when provided', () => {
      const row = minimalRow({ alertState: ALERT_STATE.ASSIGNED });
      expect(
        workflowActionToUpdatePatch(row, AlertWorkflowAction.Resolve, {
          closureComment: 'done',
          resolutionCode: 'X',
        }),
      ).toMatchObject({ alertState: ALERT_STATE.RESOLVED, closureComment: 'done', resolutionCode: 'X' });
    });

    it('DISMISS includes dismissReason when provided', () => {
      const row = minimalRow({ alertState: ALERT_STATE.ASSIGNED });
      expect(
        workflowActionToUpdatePatch(row, AlertWorkflowAction.Dismiss, {
          closureComment: 'dismissed',
          dismissReason: 'Y',
        }),
      ).toMatchObject({ alertState: ALERT_STATE.DISMISSED, closureComment: 'dismissed', dismissReason: 'Y' });
    });
  });
});

