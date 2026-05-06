import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import type { UpdateAlertRequest } from '../models/api/update-alert.request';
import { ALERT_STATE, type AlertState } from '../models/types/alert-state.type';
import { AlertWorkflowAction } from '../constants/alert-workflow-action';
import type { WorkflowActionValue } from '../models/api/alert-workflow.types';

function invalidTransition(message: string): never {
  const e = new Error(message) as Error & { statusCode: number; code: string };
  e.statusCode = 409;
  e.code = 'ILLEGAL_TRANSITION';
  throw e;
}

function workflowRequestError(message: string, statusCode: number, code: string): never {
  const e = new Error(message) as Error & { statusCode: number; code: string };
  e.statusCode = statusCode;
  e.code = code;
  throw e;
}

const terminalStates = new Set<AlertState>([ALERT_STATE.RESOLVED, ALERT_STATE.DISMISSED]);

/** Context from a workflow mutation request, mapped into an {@link UpdateAlertRequest}. */
export interface WorkflowPatchContext {
  assignToUserId?: string;
  assignedToDisplayName?: string;
  /** Effective text persisted as `closureComment` (caller should pass `closureComment ?? comment`). */
  closureComment?: string;
  resolutionCode?: string;
  dismissReason?: string;
}

export function assertWorkflowClosureComment(
  action: WorkflowActionValue,
  closureComment: string | undefined,
  comment: string | undefined = undefined,
  meta?: { resolutionCode?: string; dismissReason?: string },
): void {
  if (action !== AlertWorkflowAction.Resolve && action !== AlertWorkflowAction.Dismiss) {
    return;
  }

  const code =
    action === AlertWorkflowAction.Resolve
      ? meta?.resolutionCode?.trim()
      : meta?.dismissReason?.trim();

  if (!code) {
    workflowRequestError(
      action === AlertWorkflowAction.Resolve
        ? 'reasonCode (resolutionCode) is required for RESOLVE'
        : 'reasonCode (dismissReason) is required for DISMISS',
      422,
      'MISSING_REASON_CODE',
    );
  }

  if (code === 'OTHER' && !(closureComment?.trim() || comment?.trim())) {
    workflowRequestError('comment is required when reasonCode is OTHER', 422, 'OTHER_REQUIRES_COMMENT');
  }
}

export function workflowActionToUpdatePatch(
  row: AlertDdbRecord,
  action: WorkflowActionValue,
  ctx: WorkflowPatchContext,
): UpdateAlertRequest {
  const state = row.alertState;

  if (terminalStates.has(state)) {
    invalidTransition(`Alert ${row.alertId} is already in a terminal state (${state})`);
  }

  switch (action) {
    case AlertWorkflowAction.Assign: {
      const assignee = ctx.assignToUserId?.trim();
      if (!assignee) {
        workflowRequestError('assignedToUserId (assignToUserId) is required for ASSIGN', 422, 'MISSING_ASSIGNEE');
      }
      const display = ctx.assignedToDisplayName?.trim();
      if (!display) {
        workflowRequestError('assigneeDisplayName is required for ASSIGN', 422, 'MISSING_ASSIGNEE_DISPLAY_NAME');
      }
      // Only transition state on the forward edge UNASSIGNED -> ASSIGNED.
      // From ASSIGNED / IN_PROGRESS / WAITING, retain the current state and only update the assignee.
      const isForwardFromUnassigned = state === ALERT_STATE.UNASSIGNED;
      return {
        ...(isForwardFromUnassigned ? { alertState: ALERT_STATE.ASSIGNED } : {}),
        assignedToUserId: assignee,
        assignedToDisplayName: display,
      };
    }
    case AlertWorkflowAction.StartWork: {
      if (state !== ALERT_STATE.ASSIGNED) {
        invalidTransition(`START_WORK is not valid from state ${state}`);
      }
      return { alertState: ALERT_STATE.IN_PROGRESS };
    }
    case AlertWorkflowAction.MoveToWaiting: {
      if (state !== ALERT_STATE.IN_PROGRESS && state !== ALERT_STATE.ASSIGNED) {
        invalidTransition(`MOVE_TO_WAITING is not valid from state ${state}`);
      }
      return { alertState: ALERT_STATE.WAITING };
    }
    case AlertWorkflowAction.ResumeWork: {
      if (state !== ALERT_STATE.WAITING) {
        invalidTransition(`RESUME_WORK is not valid from state ${state}`);
      }
      return { alertState: ALERT_STATE.IN_PROGRESS };
    }
    case AlertWorkflowAction.Resolve: {
      if (
        state !== ALERT_STATE.ASSIGNED &&
        state !== ALERT_STATE.IN_PROGRESS &&
        state !== ALERT_STATE.WAITING
      ) {
        invalidTransition(`RESOLVE is not valid from state ${state}`);
      }
      const rc = ctx.resolutionCode?.trim();
      return {
        alertState: ALERT_STATE.RESOLVED,
        closureComment: ctx.closureComment,
        ...(rc ? { resolutionCode: rc } : {}),
      };
    }
    case AlertWorkflowAction.Dismiss: {
      const dr = ctx.dismissReason?.trim();
      return {
        alertState: ALERT_STATE.DISMISSED,
        closureComment: ctx.closureComment,
        ...(dr ? { dismissReason: dr } : {}),
      };
    }
    default: {
      const _exhaustive: never = action;
      invalidTransition(`Unsupported workflow action: ${String(_exhaustive)}`);
    }
  }
}
