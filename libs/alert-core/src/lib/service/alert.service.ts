import { randomUUID } from 'crypto';

import type {  } from '@api-hub/observability';

import { AlertWorkflowAction } from '../constants/alert-workflow-action';
import { DuplicateEventError } from '../errors/duplicate-event.error';
import { AlertEntityBuilder } from '../builder/alert-entity.builder';
import { AlertRepository } from '../repositories/alert-repository';
import type { CreateAlertRequest } from '../models/api/create-alert.request';
import type { UpdateAlertRequest } from '../models/api/update-alert.request';
import type { AlertActivity } from '../models/domain/alert-activity.model';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import { ALERT_STATE, type AlertState } from '../models/types/alert-state.type';
import { organizationIdsMatch } from '../utils/organization-ids-match';
import type { WorkflowInput, WorkflowResult } from '../models/api/alert-workflow.types';
import type { AssignmentInput } from '../models/api/alert-assignment.types';
import type { PriorityInput } from '../models/api/alert-priority.types';
import { AlertActivityType } from '../constants/alert-activity-type'; 
import {
  assertWorkflowClosureComment,
  workflowActionToUpdatePatch,
} from './alert-workflow';
import { BaseAlertService } from './base-alert.service';
import type { CreateAlertPayload, ListAlertsParams, ListAlertsResult } from '../models/api/create-alert.types';
import { decodeListAlertsCursor, encodeListAlertsCursor } from '../utils/alert.utils';
import { AssignmentResult, PriorityResult } from '@api-hub/alert-core'; 

/** Persisted alert row (alias for HTTP/service consumers). */
export type AlertRecord = AlertDdbRecord;
/** @deprecated Prefer {@link UpdateAlertRequest}. */
export type UpdateAlertInput = UpdateAlertRequest;
/** Activity row returned from {@link AlertService.listAlertActivity}. */
export type AlertActivityRecord = AlertActivity;

function buildTriggerSummary(input: CreateAlertRequest): string {
  if (input.triggerSummary?.trim()) return input.triggerSummary.trim();

  if (input.triggerSummaryTemplateCode) {
    const p = input.triggerSummaryParams;
    const hint = p && typeof p === 'object' && Object.keys(p).length ? ` ${JSON.stringify(p)}` : '';
    return `${input.triggerSummaryTemplateCode}${hint}`;
  }

  return `Alert: ${input.inputType}`;
}

/**
 * Alert use-cases: idempotency, upstream validation, listing, workflow mutations.
 */
export class AlertService extends BaseAlertService {
  constructor(repo?: AlertRepository, log?: any) {
    super(repo, log);
  }

  async createAlert(
    payload: CreateAlertPayload,
    authHeader?: string,
  ): Promise<{ record: AlertDdbRecord; duplicate: boolean }> {
    const input: CreateAlertRequest = { ...payload };

    const idempotencyKey = input.inputEventId ?? randomUUID(); // TODO: Remove this once we have a proper idempotency key
    const resolvedSummary = buildTriggerSummary(input);
    const keyed: CreateAlertRequest = {
      ...input,
      inputEventId: idempotencyKey,
      triggerSummary: resolvedSummary,
    };

    const resolution = await this.repo.resolveInputEventId(idempotencyKey, input.organizationId);
    if (resolution === 'foreign_org') {
      const e = new Error('This idempotency key is already in use') as Error & { statusCode: number; code: string };
      e.statusCode = 409;
      e.code = 'IDEMPOTENCY_KEY_IN_USE';
      throw e;
    }
    if (resolution !== 'missing') {
      this.log.info({
        event: 'alert_idempotent_replay',
        message: 'Idempotent replay for inputEventId',
        inputEventId: idempotencyKey,
        alertId: resolution.alertId,
        organizationId: input.organizationId,
      });
      return { record: resolution, duplicate: true };
    }

    // await Promise.all([
    //   validatePatientContext(input.patientId, input.organizationId, authHeader),
    //   validateOrganizationContext(input.organizationId, authHeader),
    // ]);

    try {
      const record = await this.repo.createAlert(keyed);
      return { record, duplicate: false };
    } catch (e: unknown) {
      const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: string }).name) : '';
      if (name === 'TransactionCanceledException' || e instanceof DuplicateEventError) {
        const again = await this.repo.resolveInputEventId(idempotencyKey, input.organizationId);
        if (again !== 'missing' && again !== 'foreign_org') {
          this.log.warn({
            event: 'alert_idempotent_after_transaction_race',
            message: 'Resolved duplicate after TransactionCanceledException',
            inputEventId: idempotencyKey,
            alertId: again.alertId,
            organizationId: input.organizationId,
          });
          return { record: again, duplicate: true };
        }
      }
      throw e;
    }
  }

  async getAlert(alertId: string, organizationId: string): Promise<AlertDdbRecord | null> {
    const row = await this.repo.getAlertById(alertId);
    if (!row) return null;
    if (!organizationIdsMatch(row.organizationId, organizationId)) return null;
    return row;
  }

  async listAlertActivity(
    alertId: string,
    organizationId: string,
    opts?: { notesOnly?: boolean },
  ): Promise<AlertActivity[]> {
    void organizationId;
    return this.repo.queryAlertActivities(alertId, opts);
  }

  /**
   * Add an operational note to an alert's activity timeline.
   */
  async addNote(
    alertId: string,
    organizationId: string,
    comment: string,
    performedByUserId?: string,
    performedByDisplayName?: string,
  ): Promise<AlertActivityRecord> {
    const existing = await this.getAlert(alertId, organizationId);
    if (!existing) {
      const e = new Error('Alert not found') as Error & { statusCode?: number; code?: string };
      e.statusCode = 404;
      e.code = 'NOT_FOUND';
      throw e;
    }

    const performer = performedByUserId?.trim() || 'SYSTEM';
    const activity = await this.repo.addNoteActivity(alertId, organizationId, comment, performer, performedByDisplayName);
    return activity as AlertActivityRecord;
  }

  async listAlerts(params: ListAlertsParams): Promise<ListAlertsResult> {
    const {
      organizationId,
      actorUserId,
      queue,
      patientId,
      state,
      assignment,
      priority,
      inputType,
      dateFrom,
      dateTo,
      search,
      limit,
      nextToken,
    } = params;

    if (queue === 'MY' && !actorUserId?.trim()) {
      const e = new Error('User id could not be resolved for MY queue') as Error & { statusCode: number };
      e.statusCode = 400;
      throw e;
    }

    const decodedCursor = nextToken?.trim() ? decodeListAlertsCursor(nextToken) : undefined;
    const exclusiveStartKey = decodedCursor;

    let rows: AlertDdbRecord[];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    if (queue === 'PATIENT') {
      const page = await this.repo.queryPatientAlertsPage(patientId!, {
        inputType,
        limit,
        openOnly: false,
        exclusiveStartKey,
        state,
        assignedToUserId: assignment,
        priority,
        dateFrom,
        dateTo,
      });
      rows = page.items;
      lastEvaluatedKey = page.lastEvaluatedKey;
    } else if (queue === 'MY') {
      const page = await this.repo.queryUserAlertsPage(actorUserId!, {
        state,
        assignedToUserId: assignment,
        limit,
        exclusiveStartKey,
        priority,
        inputType,
        dateFrom,
        dateTo,
        search,
      });
      rows = page.items;
      lastEvaluatedKey = page.lastEvaluatedKey;
    } else if (queue === 'TEAM') {
      const page = await this.repo.queryOrgAlertsGsi4Page(organizationId, {
        limit,
        exclusiveStartKey,
        state,
        assignedToUserId: assignment,
        priority,
        inputType,
        dateFrom,
        dateTo,
        search,
      });
      rows = page.items;
      lastEvaluatedKey = page.lastEvaluatedKey;
    } else {
      const exhaustive: never = queue;
      throw new Error(`Unsupported queue: ${String(exhaustive)}`);
    }
    const outNext = encodeListAlertsCursor(lastEvaluatedKey);
    return outNext ? { items: rows, nextToken: outNext } : { items: rows };
  }

  listPatientAlerts(
    patientId: string,
    q: { openOnly?: boolean; inputType?: string; limit?: number },
  ): Promise<AlertDdbRecord[]> {
    return this.repo.queryPatientAlerts(patientId, q);
  }

  listOrgAlerts(
    organizationId: string,
    q: { state?: AlertState; limit?: number; unassignedOnly?: boolean },
  ): Promise<AlertDdbRecord[]> {
    return this.repo.queryOrgAlerts(organizationId, q);
  }

  listUserAlerts(userId: string, q: { state?: AlertState; limit?: number }): Promise<AlertDdbRecord[]> {
    return this.repo.queryUserAlerts(userId, q);
  }

  updateAlert(alertId: string, patch: UpdateAlertRequest): Promise<AlertDdbRecord | null> {
    return this.repo.updateAlert(alertId, patch);
  }

  async applyWorkflow(
    organizationId: string,
    input: WorkflowInput,
  ): Promise<WorkflowResult> {
    const effectiveResolution =
      input.action === AlertWorkflowAction.Resolve ? input.reasonCode?.trim() : undefined;
    const effectiveDismiss =
      input.action === AlertWorkflowAction.Dismiss ? input.reasonCode?.trim() : undefined;

    assertWorkflowClosureComment(input.action, input.closureComment, input.comment, {
      resolutionCode: effectiveResolution,
      dismissReason: effectiveDismiss,
    });

    const failed: { alertId: string; code: string; message: string }[] = [];
    const loaded: { id: string; row: AlertDdbRecord }[] = [];

    const loadResults = await Promise.all(
      input.alertIds.map((id) =>
        this.getAlert(id, organizationId).then((row) => ({ id, row })),
      ),
    );
    for (const { id, row } of loadResults) {
      if (!row) failed.push({ alertId: id, code: 'NOT_FOUND', message: 'Alert not found' });
      else loaded.push({ id, row });
    }

    const toProcess: { id: string; row: AlertDdbRecord }[] = loaded;

    const closureText = input.closureComment?.trim() || input.comment?.trim() || undefined;
    const patchCtx = {
      assignToUserId: input.assignToUserId,
      assignedToDisplayName: input.assigneeDisplayName,
      closureComment: closureText,
      resolutionCode: effectiveResolution,
      dismissReason: effectiveDismiss,
    };
    const succeeded: string[] = [];

    // Apply the mutation to each alert concurrently to reduce end-to-end latency for bulk updates.
    // Note: `succeeded` / `failed` ordering is not guaranteed when run in parallel.
    await Promise.all(
      toProcess.map(async ({ id, row }) => {
        try {
          const patch = workflowActionToUpdatePatch(row, input.action, patchCtx);
          const nowMs = Date.now();
          const activityItems = AlertEntityBuilder.buildWorkflowActivityItems({
            existing: row,
            patch,
            performedBy: input.performedByUserId?.trim() || 'SYSTEM',
            performedByDisplayName: input.performedByDisplayName,
            nowMs,
          });
          const updated = await this.repo.updateAlert(id, patch, {
            activityItems: activityItems.length > 0 ? activityItems : undefined,
            performedByUserId: input.performedByUserId?.trim() || 'SYSTEM',
          });
          if (updated) {
            succeeded.push(id);

            const nextState = patch.alertState;
            if (nextState && nextState !== row.alertState) {
              const activityType =
                nextState === ALERT_STATE.RESOLVED
                  ? AlertActivityType.AlertResolved
                  : nextState === ALERT_STATE.DISMISSED
                    ? AlertActivityType.AlertDismissed
                    : AlertActivityType.AlertStateChanged;

              await this.publishStateChangedEventSafe({
                alertId: row.alertId,
                organizationId: row.organizationId,
                previousState: row.alertState,
                newState: nextState,
                activityType,
                performedBy: input.performedByUserId?.trim() || 'SYSTEM',
                performedByDisplayName: input.performedByDisplayName,
                activityComment:
                  nextState === ALERT_STATE.RESOLVED || nextState === ALERT_STATE.DISMISSED
                    ? patch.closureComment ?? undefined
                    : undefined,
                occurredAt: new Date(nowMs).toISOString(),
              });
            }
          } else {
            failed.push({ alertId: id, code: 'NOT_FOUND', message: 'Alert not found during update' });
          }
        } catch (e) {
          const err = e as Error & { statusCode?: number; code?: string };
          if (err.statusCode === 409 && err.code === 'ILLEGAL_TRANSITION') {
            failed.push({ alertId: id, code: err.code, message: err.message });
            return;
          }
          throw e;
        }
      }),
    );

    return {
      succeeded,
      failed,
    };
  }

  async applyAssignment(
    organizationId: string,
    input: AssignmentInput,
  ): Promise<AssignmentResult> {
    const assignToUserId = input.assignToUserId?.trim();
    const assigneeDisplayName =
      input.action === 'UNASSIGN' ? undefined : input.assigneeDisplayName?.trim();

    if ((input.action === 'ASSIGN' || input.action === 'REASSIGN') && !assignToUserId) {
      const e = new Error('assignToUserId is required for ASSIGN and REASSIGN') as Error & {
        statusCode: number;
        code: string;
      };
      e.statusCode = 422;
      e.code = 'VALIDATION_ERROR';
      throw e;
    }
    if (input.action !== 'UNASSIGN' && !assigneeDisplayName) {
      const e = new Error('assigneeDisplayName is required for ASSIGN, REASSIGN, and ASSIGN_TO_SELF') as Error & {
        statusCode: number;
        code: string;
      };
      e.statusCode = 422;
      e.code = 'VALIDATION_ERROR';
      throw e;
    }

    const byId = await this.repo.getAlertsById(input.alertIds);

    const loaded: AlertDdbRecord[] = [];
    for (const id of input.alertIds) {
      const row = byId.get(id);
      if (!row || !organizationIdsMatch(row.organizationId, organizationId)) {
        const e = new Error('Alert not found') as Error & { statusCode: number; code: string };
        e.statusCode = 404;
        e.code = 'NOT_FOUND';
        throw e;
      }
      loaded.push(row);
    }

    for (const row of loaded) {
      if (row.alertState === 'RESOLVED' || row.alertState === 'DISMISSED') {
        const e = new Error('Assignment is not allowed from terminal state') as Error & {
          statusCode: number;
          code: string;
        };
        e.statusCode = 409;
        e.code = 'TERMINAL_STATE';
        throw e;
      }
    }

    const nowMs = Date.now();
    const performedBy = input.performedByUserId?.trim() || 'SYSTEM';
    const performedByDisplayName = input.performedByDisplayName;

    const updates = loaded.map((row) => {
      // Per-row patch: only transition state on the forward edge UNASSIGNED -> ASSIGNED for assignment actions.
      // UNASSIGN clears the assignee but retains the current state; ASSIGN/REASSIGN/ASSIGN_TO_SELF from
      // ASSIGNED / IN_PROGRESS / WAITING also retains state and only updates assignee fields.
      const patch: UpdateAlertRequest =
        input.action === 'UNASSIGN'
          ? { assignedToUserId: null, assignedToDisplayName: null }
          : row.alertState === ALERT_STATE.UNASSIGNED
            ? {
                alertState: ALERT_STATE.ASSIGNED,
                assignedToUserId: assignToUserId as string,
                assignedToDisplayName: assigneeDisplayName,
              }
            : {
                assignedToUserId: assignToUserId as string,
                assignedToDisplayName: assigneeDisplayName,
              };

      const activityItems = AlertEntityBuilder.buildWorkflowActivityItems({
        existing: row,
        patch,
        performedBy,
        performedByDisplayName,
        nowMs,
      });
      return { existing: row, patch, activityItems, performedByUserId: performedBy };
    });

    await this.repo.updateAlertsTransaction(updates);

    const stateChangePublishes = updates
      .filter((update) => {
        const nextState = update.patch.alertState;
        return Boolean(nextState && nextState !== update.existing.alertState);
      })
      .map(async (update) => {
        const nextState = update.patch.alertState as AlertState;
        await this.publishStateChangedEventSafe({
          alertId: update.existing.alertId,
          organizationId: update.existing.organizationId,
          previousState: update.existing.alertState,
          newState: nextState,
          activityType:
            update.existing.alertState === ALERT_STATE.UNASSIGNED &&
            nextState === ALERT_STATE.ASSIGNED
              ? AlertActivityType.AlertAssigned
              : AlertActivityType.AlertStateChanged,
          performedBy,
          performedByDisplayName,
          occurredAt: new Date(nowMs).toISOString(),
        });
      });
    await Promise.all(stateChangePublishes);

    return {};
  }

  async applyPriority(
    organizationId: string,
    input: PriorityInput,
  ): Promise<PriorityResult> {
    const byId = await this.repo.getAlertsById(input.alertIds);

    const loaded: AlertDdbRecord[] = [];
    for (const id of input.alertIds) {
      const row = byId.get(id);
      if (!row || !organizationIdsMatch(row.organizationId, organizationId)) {
        const e = new Error('Alert not found') as Error & { statusCode: number; code: string };
        e.statusCode = 404;
        e.code = 'NOT_FOUND';
        throw e;
      }
      loaded.push(row);
    }

    const nowMs = Date.now();
    const performedBy = input.performedByUserId?.trim() || 'SYSTEM';
    const performedByDisplayName = input.performedByDisplayName;

    const updates = loaded.map((row) => {
      const patch: UpdateAlertRequest = { priority: input.priority };
      const activityItems = [
        AlertEntityBuilder.buildWorkflowActivityRow({
          alertId: row.alertId,
          organizationId: row.organizationId,
          nowMs,
          activityType: AlertActivityType.PriorityChanged,
          performedBy,
          performedByDisplayName,
          previousPriority: row.priority,
          newPriority: input.priority,
        }),
      ];
      return { existing: row, patch, activityItems };
    });

    await this.repo.updateAlertsTransaction(updates);
    return {};
  }

  private async publishStateChangedEventSafe(input: {
    alertId: string;
    organizationId: string;
    previousState: AlertState;
    newState: AlertState;
    activityType:
      | AlertActivityType.AlertAssigned
      | AlertActivityType.AlertReassigned
      | AlertActivityType.AlertStateChanged
      | AlertActivityType.AlertResolved
      | AlertActivityType.AlertDismissed;
    performedBy: string;
    performedByDisplayName?: string;
    activityComment?: string;
    occurredAt: string;
  }): Promise<void> {
    try {
      await publishAlertStateChangedEvent(input, input.alertId);
    } catch (error) {
      this.log.warn({
        event: 'alert_state_changed_publish_failed',
        message: 'Alert state changed event publish failed after persistence',
        alertId: input.alertId,
        organizationId: input.organizationId,
        previousState: input.previousState,
        newState: input.newState,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { name: 'UnknownError', message: String(error) },
      });
    }
  }
}
