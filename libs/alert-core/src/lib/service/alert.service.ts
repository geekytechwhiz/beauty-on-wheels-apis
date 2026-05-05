import { randomUUID } from 'crypto';

import type { Logger } from '@api-hub/logger';

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
import type { WorkflowMutationInput, WorkflowMutationResult } from '../models/api/alert-mutation.types';
import {
  assertWorkflowClosureComment,
  workflowActionToUpdatePatch,
} from './alert-workflow';
import { BaseAlertService } from './base-alert.service';
import type { CreateAlertPayload, ListAlertsParams, ListAlertsResult } from '../models/api/create-alert.types';
import { decodeListAlertsCursor, encodeListAlertsCursor } from '../utils/alert.utils';

/** Persisted alert row (alias for HTTP/service consumers). */
export type AlertRecord = AlertDdbRecord;
/** @deprecated Prefer {@link UpdateAlertRequest}. */
export type UpdateAlertInput = UpdateAlertRequest;
/** Activity row returned from {@link AlertService.listAlertActivity}. */
export type AlertActivityRecord = AlertActivity;

function bulkHeterogeneousError(): never {
  const e = new Error('All listed alerts must share the same alertState') as Error & {
    statusCode: number;
    code: string;
  };
  e.statusCode = 422;
  e.code = 'BULK_HETEROGENEOUS_ALERT_STATE';
  throw e;
}

function workflowApplyToGroupError(message: string): never {
  const e = new Error(message) as Error & { statusCode: number; code: string };
  e.statusCode = 400;
  e.code = 'VALIDATION_ERROR';
  throw e;
}

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
  constructor(repo?: AlertRepository, log?: Logger) {
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

  async applyWorkflowMutation(
    organizationId: string,
    input: WorkflowMutationInput,
  ): Promise<WorkflowMutationResult> {
    const effectiveResolution =
      input.action === AlertWorkflowAction.Resolve ? input.reasonCode?.trim() : undefined;
    const effectiveDismiss =
      input.action === AlertWorkflowAction.Dismiss ? input.reasonCode?.trim() : undefined;

    assertWorkflowClosureComment(input.action, input.closureComment, input.comment, {
      resolutionCode: effectiveResolution,
      dismissReason: effectiveDismiss,
    });

    const applyToGroup = input.applyToGroup === true;
    if (applyToGroup && input.alertIds.length !== 1) {
      workflowApplyToGroupError('applyToGroup requires exactly one alertId');
    }
    if (
      applyToGroup &&
      input.action !== AlertWorkflowAction.Resolve &&
      input.action !== AlertWorkflowAction.Dismiss
    ) {
      workflowApplyToGroupError('applyToGroup is only valid with RESOLVE or DISMISS');
    }

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

    if (input.alertIds.length > 1 && loaded.length === input.alertIds.length) {
      const states = new Set(loaded.map((x) => x.row.alertState));
      if (states.size > 1) bulkHeterogeneousError();
    }

    let toProcess: { id: string; row: AlertDdbRecord }[];
    if (applyToGroup) {
      if (loaded.length !== 1) {
        workflowApplyToGroupError('applyToGroup requires the primary alert to exist in your organization');
      }
      const gk = loaded[0].row.groupingKey;
      const rows = await this.repo.queryAlertsByGroupingKey(gk);
      toProcess = rows
        .filter(
          (r: AlertDdbRecord) =>
            organizationIdsMatch(r.organizationId, organizationId) &&
            r.alertState !== ALERT_STATE.RESOLVED &&
            r.alertState !== ALERT_STATE.DISMISSED,
        )
        .map((r: AlertDdbRecord) => ({ id: r.alertId, row: r }));
    } else {
      toProcess = loaded;
    }

    const closureText = input.closureComment?.trim() || input.comment?.trim() || undefined;
    const patchCtx = {
      assignToUserId: input.assignToUserId,
      closureComment: closureText,
      resolutionCode: effectiveResolution,
      dismissReason: effectiveDismiss,
    };
    const succeeded: string[] = [];

    for (const { id, row } of toProcess) {
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
        });
        if (updated) succeeded.push(id);
        else failed.push({ alertId: id, code: 'NOT_FOUND', message: 'Alert not found during update' });
      } catch (e) {
        const err = e as Error & { statusCode?: number; code?: string };
        if (err.statusCode === 409 && err.code === 'ILLEGAL_TRANSITION') {
          failed.push({ alertId: id, code: err.code, message: err.message });
          continue;
        }
        throw e;
      }
    }

    let primaryAlert: AlertDdbRecord | undefined;
    if (input.alertIds.length === 1 && succeeded.includes(input.alertIds[0])) {
      primaryAlert = (await this.getAlert(input.alertIds[0], organizationId)) ?? undefined;
    }

    return {
      succeeded,
      failed,
      ...(applyToGroup ? { affectedCount: succeeded.length } : {}),
      ...(primaryAlert ? { primaryAlert } : {}),
    };
  }
}
