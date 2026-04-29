import { randomUUID } from 'crypto';

import { createLogger } from '@api-hub/logger';

import {
  AlertRepository,
  AlertWorkflowAction,
  type AlertActivityRecord,
  type AlertRecord,
  type CreateAlertInput,
  type UpdateAlertInput,
  type AlertState,
} from '@api-hub/alert-repository';

import { validatePatientContext } from './clients/user-service.client';
import { validateOrganizationContext } from './clients/organization-service.client';
import type { WorkflowMutationInput, WorkflowMutationResult } from './alert-mutation.types';
import {
  assertWorkflowClosureComment,
  workflowActionToUpdatePatch,
} from './alert-workflow';
import type { CreateAlertPayload, ListAlertsParams, ListAlertsQueue } from './create-alert.types';

const log = createLogger({ service: 'alert-service', redactPII: true });

/** Compare stored org id with JWT org (either may use optional `ORG#` prefix). */
function organizationIdsMatch(recordOrg: string | undefined, requestOrg: string): boolean {
  if (!recordOrg?.trim() || !requestOrg.trim()) return false;
  const norm = (id: string) =>
    id
      .trim()
      .replace(/^ORG#/i, '')
      .toLowerCase();
  return norm(recordOrg) === norm(requestOrg);
}

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

function buildTriggerSummary(input: CreateAlertInput): string {
  if (input.triggerSummary?.trim()) return input.triggerSummary.trim();

  if (input.triggerSummaryTemplateCode) {
    const p = input.triggerSummaryParams;
    const hint = p && typeof p === 'object' && Object.keys(p).length ? ` ${JSON.stringify(p)}` : '';
    return `${input.triggerSummaryTemplateCode}${hint}`;
  }

  return `Alert: ${input.inputType}`;
}

/**
 * Use-case / orchestration layer for alerts. Owns idempotency policy, upstream patient/org validation, and
 * transaction race handling; persists only through {@link AlertRepository}. No API Gateway envelope or JWT parsing.
 *
 * @see `apps/alert-service/docs/http-api-implementation-guide.md` §3
 */
export class AlertService {
  constructor(private readonly repo: AlertRepository = new AlertRepository()) {}

  /**
   * Creates an alert or returns an existing one when the same `inputEventId` was already used for this organization
   * (EVENT# idempotency). The same patient and org can have many alerts; they must use different idempotency keys.
   * **`POST /alerts`** clients (e.g. care UI) should send a stable **`inputEventId`**; the HTTP schema requires it.
   *
   * Omitted `inputEventId` (non-HTTP callers only) yields a new UUID idempotency key.
   * **`inputType` and `sourceType` must be set by the caller** (e.g. from the HTTP body or async producer), not inferred here.
   *
   * @param authHeader - Forwarded to user-service / organization-service for “in org” checks.
   * @returns `duplicate: true` when replaying the same idempotency key for the same org (HTTP layer should respond 409).
   */
  async createAlert(
    payload: CreateAlertPayload,
    authHeader?: string,
  ): Promise<{ record: AlertRecord; duplicate: boolean }> {
    const input: CreateAlertInput = { ...payload };

    const idempotencyKey = input.inputEventId ?? randomUUID();
    const resolvedSummary = buildTriggerSummary(input);
    const keyed: CreateAlertInput = {
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
      log.info({
        event: 'alert_idempotent_replay',
        message: 'Idempotent replay for inputEventId',
        inputEventId: idempotencyKey,
        alertId: resolution.alertId,
        organizationId: input.organizationId,
      });
      return { record: resolution, duplicate: true };
    }

    await Promise.all([
      validatePatientContext(input.patientId, input.organizationId, authHeader),
      validateOrganizationContext(input.organizationId, authHeader),
    ]);

    try {
      const record = await this.repo.createAlert(keyed);
      return { record, duplicate: false };
    } catch (e: unknown) {
      const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: string }).name) : '';
      if (name === 'TransactionCanceledException') {
        const again = await this.repo.resolveInputEventId(idempotencyKey, input.organizationId);
        if (again !== 'missing' && again !== 'foreign_org') {
          log.warn({
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

  /**
   * Loads `ALERT#id` / `METADATA`. Returns null if missing or if `organizationId` does not own the alert.
   */
  async getAlert(alertId: string, organizationId: string): Promise<AlertRecord | null> {
    const row = await this.repo.getAlertById(alertId);
    if (!row) return null;
    if (!organizationIdsMatch(row.organizationId, organizationId)) return null;
    return row;
  }

  /**
   * Full activity timeline for an alert (all rows). Returns null if the alert is missing or not in `organizationId`.
   */
  async listAlertActivity(alertId: string, organizationId: string): Promise<AlertActivityRecord[] | null> {
    const alert = await this.getAlert(alertId, organizationId);
    if (!alert) return null;
    return this.repo.queryAlertActivities(alertId);
  }

  /**
   * Unified list for GET /alerts: Team / My / Patient queues, repo queries + shared post-filters.
   */
  async listAlerts(params: ListAlertsParams): Promise<AlertRecord[]> {
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
    } = params;

    if (queue === 'MY' && !actorUserId?.trim()) {
      const e = new Error('User id could not be resolved for MY queue') as Error & { statusCode: number };
      e.statusCode = 400;
      throw e;
    }

    let rows: AlertRecord[];

    if (queue === 'PATIENT') {
      rows = await this.listPatientAlerts(patientId!, {
        inputType,
        limit,
        openOnly: false,
      });
    } else if (queue === 'MY') {
      rows = await this.listUserAlerts(actorUserId!, { state, limit });
    } else {
      let orgState: AlertState;
      if (state) {
        orgState = state;
      } else if (assignment === 'ASSIGNED') {
        orgState = 'ASSIGNED';
      } else {
        orgState = 'UNASSIGNED';
      }
      const unassignedOnly = assignment === 'UNASSIGNED';
      rows = await this.listOrgAlerts(organizationId, {
        state: orgState,
        unassignedOnly,
        limit,
      });
    }

    return this.applyListPostFilters(rows, organizationId, {
      queue,
      priority,
      inputType,
      state,
      assignment: queue === 'TEAM' ? assignment : undefined,
      dateFrom,
      dateTo,
      search,
    });
  }

  private applyListPostFilters(
    rows: AlertRecord[],
    organizationId: string,
    opts: {
      queue: ListAlertsQueue;
      priority?: string;
      inputType?: string;
      state?: AlertState;
      assignment?: 'UNASSIGNED' | 'ASSIGNED';
      dateFrom?: string;
      dateTo?: string;
      search?: string;
    },
  ): AlertRecord[] {
    let items =
      opts.queue === 'TEAM' ? rows : rows.filter((a) => a.organizationId === organizationId);

    if (opts.priority?.trim()) {
      const p = opts.priority.trim();
      items = items.filter((a) => a.priority === p);
    }
    if (opts.queue !== 'PATIENT' && opts.inputType?.trim()) {
      const t = opts.inputType.trim();
      items = items.filter((a) => a.inputType === t);
    }

    if (opts.queue === 'PATIENT' && opts.state) {
      items = items.filter((a) => a.alertState === opts.state);
    }

    if (opts.queue === 'TEAM' && opts.assignment === 'ASSIGNED') {
      items = items.filter((a) => !!a.assignedToUserId);
    }

    const fromTs = opts.dateFrom ? Date.parse(opts.dateFrom) : NaN;
    if (!Number.isNaN(fromTs)) {
      items = items.filter((a) => Date.parse(a.triggerTimestamp) >= fromTs);
    }
    const toTs = opts.dateTo ? Date.parse(opts.dateTo) : NaN;
    if (!Number.isNaN(toTs)) {
      items = items.filter((a) => Date.parse(a.triggerTimestamp) <= toTs);
    }

    const q = opts.search?.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (a) =>
          a.alertId.toLowerCase().includes(q) ||
          a.triggerSummary.toLowerCase().includes(q) ||
          a.patientId.toLowerCase().includes(q),
      );
    }

    return items;
  }

  listPatientAlerts(
    patientId: string,
    q: { openOnly?: boolean; inputType?: string; limit?: number },
  ): Promise<AlertRecord[]> {
    return this.repo.queryPatientAlerts(patientId, q);
  }

  listOrgAlerts(
    organizationId: string,
    q: { state?: AlertState; limit?: number; unassignedOnly?: boolean },
  ): Promise<AlertRecord[]> {
    return this.repo.queryOrgAlerts(organizationId, q);
  }

  listUserAlerts(userId: string, q: { state?: AlertState; limit?: number }): Promise<AlertRecord[]> {
    return this.repo.queryUserAlerts(userId, q);
  }

  updateAlert(alertId: string, patch: UpdateAlertInput): Promise<AlertRecord | null> {
    return this.repo.updateAlert(alertId, patch);
  }

  /** POST `/alerts/workflow` — see `docs/services/alert-service/api/open-api.yaml`. */
  async applyWorkflowMutation(
    organizationId: string,
    input: WorkflowMutationInput,
  ): Promise<WorkflowMutationResult> {
    assertWorkflowClosureComment(input.action, input.closureComment);

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
    const loaded: { id: string; row: AlertRecord }[] = [];

    for (const id of input.alertIds) {
      const row = await this.getAlert(id, organizationId);
      if (!row) failed.push({ alertId: id, code: 'NOT_FOUND', message: 'Alert not found' });
      else loaded.push({ id, row });
    }

    if (input.alertIds.length > 1 && loaded.length === input.alertIds.length) {
      const states = new Set(loaded.map((x) => x.row.alertState));
      if (states.size > 1) bulkHeterogeneousError();
    }

    let toProcess: { id: string; row: AlertRecord }[];
    if (applyToGroup) {
      if (loaded.length !== 1) {
        workflowApplyToGroupError('applyToGroup requires the primary alert to exist in your organization');
      }
      const gk = loaded[0].row.groupingKey;
      const rows = await this.repo.queryAlertsByGroupingKey(gk);
      toProcess = rows
        .filter(
          (r) =>
            organizationIdsMatch(r.organizationId, organizationId) &&
            r.alertState !== 'RESOLVED' &&
            r.alertState !== 'DISMISSED',
        )
        .map((r) => ({ id: r.alertId, row: r }));
    } else {
      toProcess = loaded;
    }

    const patchCtx = { assignToUserId: input.assignToUserId };
    const succeeded: string[] = [];

    for (const { id, row } of toProcess) {
      try {
        const patch = workflowActionToUpdatePatch(row, input.action, patchCtx);
        const updated = await this.repo.updateAlert(id, patch);
        if (updated) succeeded.push(id);
        else failed.push({ alertId: id, code: 'NOT_FOUND', message: 'Alert not found during update' });
      } catch (e) {
        const err = e as Error & { statusCode?: number; code?: string };
        if (err.statusCode === 400 && err.code === 'INVALID_WORKFLOW_TRANSITION') {
          failed.push({ alertId: id, code: err.code, message: err.message });
          continue;
        }
        throw e;
      }
    }

    let primaryAlert: AlertRecord | undefined;
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
