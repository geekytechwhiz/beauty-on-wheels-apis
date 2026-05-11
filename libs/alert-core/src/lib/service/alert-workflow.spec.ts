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
        assignedToUserId: 'user-new',
        assignedToDisplayName: 'User New',
      });
    });

    it('IN_PROGRESS retains state and only updates assignee', () => {
      const row = minimalRow({ alertState: ALERT_STATE.IN_PROGRESS, assignedToUserId: 'user-old' });
      const patch = workflowActionToUpdatePatch(row, AlertWorkflowAction.Assign, {
        assignToUserId: 'user-new',
        assignedToDisplayName: 'User New',
      });
      expect(patch).toEqual({
        assignedToUserId: 'user-new',
        assignedToDisplayName: 'User New',
      });
      expect(patch).not.toHaveProperty('alertState');
    });

    it('WAITING retains state and only updates assignee', () => {
      const row = minimalRow({ alertState: ALERT_STATE.WAITING, assignedToUserId: 'user-old' });
      const patch = workflowActionToUpdatePatch(row, AlertWorkflowAction.Assign, {
        assignToUserId: 'user-new',
        assignedToDisplayName: 'User New',
      });
      expect(patch).toEqual({
        assignedToUserId: 'user-new',
        assignedToDisplayName: 'User New',
      });
      expect(patch).not.toHaveProperty('alertState');
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
      try {
        workflowActionToUpdatePatch(row, AlertWorkflowAction.StartWork, {});
        throw new Error('Expected workflowActionToUpdatePatch to throw');
      } catch (e) {
        expect(e).toMatchObject({ statusCode: 409, code: 'ILLEGAL_TRANSITION' });
      }
    });
  });

  describe('RESOLVE', () => {
    it('rejects UNASSIGNED', () => {
      const row = minimalRow({ alertState: ALERT_STATE.UNASSIGNED });
      try {
        workflowActionToUpdatePatch(row, AlertWorkflowAction.Resolve, { resolutionCode: 'X' });
        throw new Error('Expected workflowActionToUpdatePatch to throw');
      } catch (e) {
        expect(e).toMatchObject({ statusCode: 409, code: 'ILLEGAL_TRANSITION' });
      }
    });
  });

  describe('terminal states', () => {
    it('rejects transitions from RESOLVED', () => {
      const row = minimalRow({ alertState: ALERT_STATE.RESOLVED });
      try {
        workflowActionToUpdatePatch(row, AlertWorkflowAction.Dismiss, {});
        throw new Error('Expected workflowActionToUpdatePatch to throw');
      } catch (e) {
        expect(e).toMatchObject({ statusCode: 409, code: 'ILLEGAL_TRANSITION' });
      }
    });
  });

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

  describe('workflowActionToUpdatePatch (edge cases)', () => {
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

