import { randomUUID } from 'crypto';

import type { CreateAlertRequest } from '../models/api/create-alert.request';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';

import { AlertKeyBuilder } from './alert-key.builder';
import { ACTIVITY_TYPE_ALERT_CREATED, ALERT_METADATA_SK } from '../constants/alert.constants';
import { AlertActivityType } from '../constants/alert-activity-type';
import { UpdateAlertRequest } from '../models/api/update-alert.request';
import { ALERT_STATE, type AlertState } from '../models/types/alert-state.type';
import { toEpochMs } from '../utils/alert-time';

const MS_PER_MINUTE = 60_000;

export interface CreateAlertContext {
  alertId: string;
  /** Write time, Unix epoch ms (UTC). */
  nowMs: number;
  /** From create request `triggerTimestamp` (epoch ms). */
  triggerMs: number;
  input: CreateAlertRequest;
  groupingKey: string;
}

export class AlertEntityBuilder {
  // -----------------------------
  // Utilities
  // -----------------------------
  /** @deprecated Prefer epoch ms; kept for callers that need an ISO string. */
  static nowIso(): string {
    return new Date().toISOString();
  }

  static nowMs(): number {
    return Date.now();
  }

  // -----------------------------
  // Context Builder
  // -----------------------------
  static buildCreateContext(params: { alertId: string; input: CreateAlertRequest }): CreateAlertContext {
    const { alertId, input } = params;

    const triggerMs = Math.floor(input.triggerTimestamp);
    const nowMs = Date.now();

    return {
      alertId,
      nowMs,
      triggerMs,
      input,
      groupingKey: input.groupingKey,
    };
  }

  // -----------------------------
  // Main Alert Record (DDB)
  // -----------------------------
  static buildAlertRecord(ctx: CreateAlertContext): AlertDdbRecord {
    const { alertId, nowMs, triggerMs, input, groupingKey } = ctx;

    const pk = AlertKeyBuilder.toAlertPk(alertId);
    const sk = ALERT_METADATA_SK;

    const assignSlaMinutes = input.assignSlaMinutes;
    const resolveSlaMinutes = input.resolveSlaMinutes;
    const assignSlaDueAt = assignSlaMinutes > 0 ? nowMs + assignSlaMinutes * MS_PER_MINUTE : nowMs;

    return {
      // 🔑 Keys
      pk,
      sk,
      entityType: 'ALERT',

      // 🔹 Domain fields
      id: alertId,
      alertId,
      organizationId: input.organizationId,
      patientId: input.patientId,
      patientName: input.patientName,
      actorName: input.actorName || 'SYSTEM',

      inputEventId: input.inputEventId,
      inputType: input.inputType,
      sourceType: input.sourceType,

      triggerTimestamp: triggerMs,
      triggerSummary: input.triggerSummary ?? '',

      triggerSummaryTemplateCode: input.triggerSummaryTemplateCode,
      triggerSummaryParams: input.triggerSummaryParams,

      evidencePayload: input.evidencePayload,

      priority: input.priority,
      alertState: ALERT_STATE.UNASSIGNED,

      groupingKey,

      appliesToType: input.appliesToType,
      linkedEntityCode: input.linkedEntityCode,
      severityHint: input.severityHint,

      carePlanInstanceId: input.carePlanInstanceId,
      packageAssignmentId: input.packageAssignmentId,

      alertPolicyTemplateVersionId: input.alertPolicyTemplateVersionId,
      thresholdTemplateVersionId: input.thresholdTemplateVersionId,

      // 🔹 Assignment
      assignedToUserId: undefined,
      assignedAt: undefined,
      assignedBy: undefined,

      // 🔹 SLA — assign clock starts at creation; resolve clock starts at first assignment.
      assignSlaMinutes,
      resolveSlaMinutes,
      assignSlaDueAt,
      slaBreachIndicator: false,

      // 🔹 Workflow
      statusUpdatedAt: nowMs,
      statusUpdatedBy: input.actorUserId,

      closureComment: undefined,
      resolutionCode: undefined,
      dismissReason: undefined,

      // 🔹 Audit
      createdAt: nowMs,
      updatedAt: nowMs,
      createdBy: input.actorUserId,
      updatedBy: input.actorUserId,

      // 🔹 GSIs
      gsi1pk: AlertKeyBuilder.buildGsi1Pk(input.organizationId, ALERT_STATE.UNASSIGNED),
      gsi1sk: AlertKeyBuilder.buildGsi1Sk(nowMs),

      gsi2pk: undefined,
      gsi2sk: undefined,

      gsi3pk: AlertKeyBuilder.toPatPartitionKey(input.patientId),
      gsi3sk: AlertKeyBuilder.toGsi3Sk(nowMs),

      gsi4pk: AlertKeyBuilder.buildGsi4Pk(input.organizationId),
      gsi4sk: AlertKeyBuilder.buildGsi4Sk(nowMs, alertId),

      gsi5pk: AlertKeyBuilder.toSlaPartitionKey(nowMs),
      gsi5sk: AlertKeyBuilder.toSlaSortKey(nowMs, alertId),
    };
  }

  // -----------------------------
  // Activity Record
  // -----------------------------
  static buildCreateActivity(ctx: CreateAlertContext) {
    const { alertId, nowMs, input } = ctx;
    const activityId = randomUUID();
    return {
      pk: AlertKeyBuilder.toAlertPk(alertId),
      sk: AlertKeyBuilder.toActivitySortKey(nowMs, activityId),

      entityType: 'ALERT_ACTIVITY',

      activityId,
      alertId,

      activityType: ACTIVITY_TYPE_ALERT_CREATED,
      activityTimestamp: nowMs,

      performedBy: input.actorUserId ?? 'SYSTEM',
      performedByDisplayName: input.actorName,

      activityComment: 'Alert created',

      previousState: undefined,
      newState: ALERT_STATE.UNASSIGNED,

      previousPriority: undefined,
      newPriority: input.priority ?? 'P2',

      previousAssignee: undefined,
      newAssignee: undefined,

      evidencePayload: input.evidencePayload,

      createdAt: nowMs,
      organizationId: input.organizationId,
    };
  }

  // -----------------------------
  // Event (Idempotency)
  // -----------------------------
  static buildEvent(ctx: CreateAlertContext) {
    const { input, alertId, nowMs } = ctx;

    return {
      pk: `EVENT#${input.inputEventId}`,
      sk: ALERT_METADATA_SK,

      entityType: 'ALERT_EVENT',

      alertId,
      organizationId: input.organizationId,

      createdAt: nowMs,
    };
  }

  /**
   * Base-table row: `pk = GROUP#<groupingKey>`, `sk = Alert#<paddedEpochMs>#<alertId>` (`paddedEpochMs` = create time).
   * Written in the same transact as create; use {@link AlertRepository.queryAlertsByGroupingKey} to load alerts.
   */
  static buildGroupMembershipPut(ctx: CreateAlertContext) {
    const { alertId, nowMs, input, groupingKey } = ctx;

    return {
      Put: {
        TableName: process.env.ALERT_TABLE!,
        Item: {
          pk: AlertKeyBuilder.toGroupPartitionKey(groupingKey),
          sk: AlertKeyBuilder.buildGroupMembershipSk(ctx.nowMs, alertId),
          organizationId: input.organizationId,
          createdAt: nowMs,
        },
      },
    };
  }

  // -----------------------------
  // Return clean response object
  // -----------------------------
  static buildAlertItem(ctx: CreateAlertContext) {
    return {
      alertId: ctx.alertId,
      groupingKey: ctx.groupingKey,
      alertState: ALERT_STATE.UNASSIGNED,
      createdAt: ctx.nowMs,
    };
  }

  static buildUpdateExpression(
    existing: AlertDdbRecord,
    patch: UpdateAlertRequest,
    opts?: {
      /**
       * Actor who performed the assignment mutation (not the assignee).
       * Used to populate `assignedBy` when `assignedToUserId` is set.
       */
      performedByUserId?: string;
    },
  ) {
    const nowMs = Date.now();
    /** Sort-key segment matches {@link buildAlertRecord}: creation instant, not clinical trigger. */
    const sortEpochMs = toEpochMs(existing.createdAt);

    const setExpressions: string[] = [];
    const removeExpressions: string[] = [];
    const expressionAttributeValues: Record<string, unknown> = {};
    const expressionAttributeNames: Record<string, string> = {};

    const setField = (key: string, value: unknown) => {
      const nameKey = `#${key}`;
      const valueKey = `:${key}`;
      expressionAttributeNames[nameKey] = key;
      expressionAttributeValues[valueKey] = value;
      setExpressions.push(`${nameKey} = ${valueKey}`);
    };

    const removeField = (key: string) => {
      const nameKey = `#${key}`;
      expressionAttributeNames[nameKey] = key;
      removeExpressions.push(nameKey);
    };

    if (patch.alertState && patch.alertState !== existing.alertState) {
      setField('alertState', patch.alertState);
      setField('statusUpdatedAt', nowMs);

      setField('gsi1pk', AlertKeyBuilder.buildGsi1Pk(existing.organizationId, patch.alertState));
      setField('gsi1sk', AlertKeyBuilder.buildGsi1Sk(sortEpochMs));

      // If assignment is being updated in the same call, the assignment block will manage GSI2 keys.
      if (existing.assignedToUserId && patch.assignedToUserId === undefined) {
        setField('gsi2sk', AlertKeyBuilder.buildGsi2Sk(sortEpochMs, existing.alertId));
      }
    }

    if (patch.assignedToUserId !== undefined) {
      if (patch.assignedToUserId === null) {
        removeField('assignedToUserId');
        removeField('assignedToDisplayName');
        removeField('assignedAt');
        removeField('assignedBy');
        removeField('gsi2pk');
        removeField('gsi2sk');
      } else {
        setField('assignedToUserId', patch.assignedToUserId);
        setField('assignedAt', nowMs);
        // `assignedBy` should represent the actor who performed the assignment (JWT actor), not the assignee.
        setField('assignedBy', opts?.performedByUserId?.trim() || patch.assignedToUserId);
        if (patch.assignedToDisplayName !== undefined) {
          setField('assignedToDisplayName', patch.assignedToDisplayName);
        }

        setField('gsi2pk', AlertKeyBuilder.toUserPartitionKey(patch.assignedToUserId));

        setField('gsi2sk', AlertKeyBuilder.buildGsi2Sk(sortEpochMs, existing.alertId));

        // First-assignment only: start the resolve-SLA clock and re-key GSI5 to the resolve due date.
        // Subsequent reassignments do NOT reset resolveSlaDueAt or rewrite GSI5.
        const isFirstAssignment = !existing.assignedToUserId;
        if (isFirstAssignment) {
          const minutes = existing.resolveSlaMinutes;
          if (minutes > 0) {
            const due = nowMs + minutes * MS_PER_MINUTE;
            if (existing.resolveSlaMinutes == null) setField('resolveSlaMinutes', minutes);
            setField('resolveSlaDueAt', due);
            setField('gsi5pk', AlertKeyBuilder.toSlaPartitionKey(due));
            setField('gsi5sk', AlertKeyBuilder.toSlaSortKey(due, existing.alertId));
          }
        }
      }
    }

    if (patch.assignedToUserId === undefined && patch.assignedToDisplayName !== undefined) {
      // Allow standalone display-name correction without changing assignee id.
      if (patch.assignedToDisplayName === null) removeField('assignedToDisplayName');
      else setField('assignedToDisplayName', patch.assignedToDisplayName);
    }

    if (patch.priority !== undefined) {
      setField('priority', patch.priority);
    }

    if (patch.slaBreachIndicator !== undefined) {
      setField('slaBreachIndicator', patch.slaBreachIndicator);
    }

    if (patch.closureComment !== undefined) {
      setField('closureComment', patch.closureComment);
    }

    if (patch.resolutionCode !== undefined) {
      setField('resolutionCode', patch.resolutionCode);
    }

    if (patch.dismissReason !== undefined) {
      setField('dismissReason', patch.dismissReason);
    }

    setField('updatedAt', nowMs);

    const UpdateExpression = [
      setExpressions.length ? `SET ${setExpressions.join(', ')}` : '',
      removeExpressions.length ? `REMOVE ${removeExpressions.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' ');

    return {
      TableName: process.env.ALERT_TABLE!,
      Key: {
        pk: existing.pk,
        sk: existing.sk,
      },
      UpdateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    };
  }

  /**
   * Activity rows for GET alert activity after a workflow {@link UpdateAlertRequest}.
   * Order: assignment change (if any), then terminal/state activity.
   */
  static buildWorkflowActivityItems(params: {
    existing: AlertDdbRecord;
    patch: UpdateAlertRequest;
    performedBy: string;
    performedByDisplayName?: string;
    nowMs: number;
  }): Record<string, unknown>[] {
    const { existing, patch } = params;
    const nowMs = params.nowMs;
    const performedBy = params.performedBy?.trim() || 'SYSTEM';
    const performedByDisplayName = params.performedByDisplayName;

    const items: Record<string, unknown>[] = [];
    const prevAssign = existing.assignedToUserId?.trim() || undefined;
    const newAssign =
      patch.assignedToUserId === undefined
        ? undefined
        : patch.assignedToUserId === null
          ? undefined
          : String(patch.assignedToUserId).trim();
    const assigneeChanged =
      patch.assignedToUserId !== undefined && (prevAssign ?? '') !== (newAssign ?? '');

    if (assigneeChanged) {
      const activityType =
        prevAssign == null ? AlertActivityType.AlertAssigned : AlertActivityType.AlertReassigned;
      items.push(
        AlertEntityBuilder.buildWorkflowActivityRow({
          alertId: existing.alertId,
          organizationId: existing.organizationId,
          nowMs: nowMs,
          activityType,
          performedBy,
          performedByDisplayName,
          previousAssignee: prevAssign,
          newAssignee: newAssign,
          previousAssigneeDisplayName: existing.assignedToDisplayName,
          newAssigneeDisplayName: patch.assignedToDisplayName ?? undefined,
        }),
      );
    }

    if (patch.alertState && patch.alertState !== existing.alertState) {
      // For ASSIGN, we emit only the assignment activity (ALERT_ASSIGNED / ALERT_REASSIGNED).
      // The UNASSIGNED -> ASSIGNED state change is implicit in assignment and should not create a second activity row.
      const isImplicitAssignStateChange =
        assigneeChanged &&
        existing.alertState === ALERT_STATE.UNASSIGNED &&
        patch.alertState === ALERT_STATE.ASSIGNED;
      if (isImplicitAssignStateChange) {
        return items;
      }

      let activityType: AlertActivityType = AlertActivityType.AlertStateChanged;
      if (patch.alertState === ALERT_STATE.RESOLVED) activityType = AlertActivityType.AlertResolved;
      if (patch.alertState === ALERT_STATE.DISMISSED) activityType = AlertActivityType.AlertDismissed;

      const activityComment =
        patch.alertState === ALERT_STATE.RESOLVED || patch.alertState === ALERT_STATE.DISMISSED
          ? patch.closureComment ?? undefined
          : undefined;

      items.push(
        AlertEntityBuilder.buildWorkflowActivityRow({
          alertId: existing.alertId,
          organizationId: existing.organizationId,
          nowMs: nowMs,
          activityType,
          performedBy,
          performedByDisplayName,
          activityComment,
          previousState: existing.alertState,
          newState: patch.alertState,
        }),
      );
    }

    return items;
  }

  static buildWorkflowActivityRow(p: {
    alertId: string;
    organizationId: string;
    nowMs: number;
    activityType: string;
    performedBy: string;
    performedByDisplayName?: string;
    activityComment?: string;
    previousState?: AlertState;
    newState?: AlertState;
    previousPriority?: string;
    newPriority?: string;
    previousAssignee?: string;
    newAssignee?: string;
    previousAssigneeDisplayName?: string;
    newAssigneeDisplayName?: string;
  }): Record<string, unknown> {
    const activityId = randomUUID();
    return {
      pk: AlertKeyBuilder.toAlertPk(p.alertId),
      sk: AlertKeyBuilder.toActivitySortKey(p.nowMs, activityId),
      entityType: 'ALERT_ACTIVITY',
      activityId,
      alertId: p.alertId,
      activityType: p.activityType,
      activityTimestamp: p.nowMs,
      performedBy: p.performedBy,
      ...(p.performedByDisplayName ? { performedByDisplayName: p.performedByDisplayName } : {}),
      ...(p.activityComment ? { activityComment: p.activityComment } : {}),
      ...(p.previousState !== undefined ? { previousState: p.previousState } : {}),
      ...(p.newState !== undefined ? { newState: p.newState } : {}),
      ...(p.previousPriority !== undefined ? { previousPriority: p.previousPriority } : {}),
      ...(p.newPriority !== undefined ? { newPriority: p.newPriority } : {}),
      ...(p.previousAssignee !== undefined ? { previousAssignee: p.previousAssignee } : {}),
      ...(p.newAssignee !== undefined ? { newAssignee: p.newAssignee } : {}),
      ...(p.previousAssigneeDisplayName ? { previousAssigneeDisplayName: p.previousAssigneeDisplayName } : {}),
      ...(p.newAssigneeDisplayName ? { newAssigneeDisplayName: p.newAssigneeDisplayName } : {}),
      createdAt: p.nowMs,
      organizationId: p.organizationId,
    };
  }
}
