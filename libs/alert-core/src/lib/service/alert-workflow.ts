import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import type { UpdateAlertRequest } from '../models/api/update-alert.request';
import { AlertWorkflowAction } from '../constants/alert-workflow-action';
import type { WorkflowActionValue } from '../models/api/alert-mutation.types';

function invalidTransition(message: string): never {
  const e = new Error(message) as Error & { statusCode: number; code: string };
  e.statusCode = 400;
  e.code = 'INVALID_WORKFLOW_TRANSITION';
  throw e;
}

const terminalStates = new Set(['RESOLVED', 'DISMISSED'] as const);

/** Context from a workflow mutation request, mapped into an {@link UpdateAlertRequest}. */
export interface WorkflowPatchContext {
  assignToUserId?: string;
  /** Effective text persisted as `closureComment` (caller should pass `closureComment ?? comment`). */
  closureComment?: string;
  resolutionCode?: string;
  dismissReason?: string;
}

export function assertWorkflowClosureComment(
  action: WorkflowActionValue,
  closureComment: string | undefined,
  comment: string | undefined = undefined,
): void {
  if (action === AlertWorkflowAction.Resolve || action === AlertWorkflowAction.Dismiss) {
    if (!(closureComment?.trim() || comment?.trim())) {
      invalidTransition('closureComment or comment is required for RESOLVE and DISMISS');
    }
  }
}

export function workflowActionToUpdatePatch(
  row: AlertDdbRecord,
  action: WorkflowActionValue,
  ctx: WorkflowPatchContext,
): UpdateAlertRequest {
  const state = row.alertState;

  if (terminalStates.has(state as 'RESOLVED' | 'DISMISSED')) {
    invalidTransition(`Alert ${row.alertId} is already in a terminal state (${state})`);
  }

  switch (action) {
    case AlertWorkflowAction.StartWork: {
      if (state !== 'UNASSIGNED' && state !== 'ASSIGNED') {
        invalidTransition(`START_WORK is not valid from state ${state}`);
      }
      const patch: UpdateAlertRequest = { alertState: 'IN_PROGRESS' };
      if (state === 'UNASSIGNED' && ctx.assignToUserId?.trim()) {
        patch.assignedToUserId = ctx.assignToUserId.trim();
      }
      return patch;
    }
    case AlertWorkflowAction.Wait: {
      if (state !== 'IN_PROGRESS' && state !== 'ASSIGNED') {
        invalidTransition(`WAIT is not valid from state ${state}`);
      }
      return { alertState: 'WAITING' };
    }
    case AlertWorkflowAction.Resume: {
      if (state !== 'WAITING') {
        invalidTransition(`RESUME is not valid from state ${state}`);
      }
      return { alertState: 'IN_PROGRESS' };
    }
    case AlertWorkflowAction.Resolve: {
      const rc = ctx.resolutionCode?.trim();
      return {
        alertState: 'RESOLVED',
        closureComment: ctx.closureComment,
        ...(rc ? { resolutionCode: rc } : {}),
      };
    }
    case AlertWorkflowAction.Dismiss: {
      const dr = ctx.dismissReason?.trim();
      return {
        alertState: 'DISMISSED',
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
