import { randomUUID } from 'crypto';

import type { CreateAlertRequest } from '../models/api/create-alert.request';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';

import { AlertKeyBuilder } from './alert-key.builder';
import { ALERT_METADATA_SK } from '../constants/alert.constants';
import { UpdateAlertRequest } from '../models/api/update-alert.request';

export interface CreateAlertContext {
  alertId: string;
  now: string;
  input: CreateAlertRequest;
  groupingKey: string;
}

export class AlertEntityBuilder {
  // -----------------------------
  // Utilities
  // -----------------------------
  static nowIso(): string {
    return new Date().toISOString();
  }

  // -----------------------------
  // Context Builder
  // -----------------------------
  static buildCreateContext(params: {
    alertId: string;
    now: string;
    input: CreateAlertRequest;
  }): CreateAlertContext {
    const { alertId, now, input } = params;

    const groupingKey =
      input.groupingKey ??
      `${input.patientId}|${input.linkedEntityCode ?? 'GENERIC'}|OPEN`;

    return {
      alertId,
      now,
      input,
      groupingKey,
    };
  }

  // -----------------------------
  // Main Alert Record (DDB)
  // -----------------------------
  static buildAlertRecord(ctx: CreateAlertContext): AlertDdbRecord {
    const { alertId, now, input, groupingKey } = ctx;

    const pk = AlertKeyBuilder.toAlertPk(alertId);
    const sk = ALERT_METADATA_SK;

    return {
      // 🔑 Keys
      TableName: process.env.ALERT_TABLE!,
      pk,
      sk,
      entityType: 'ALERT',

      // 🔹 Domain fields
      id: alertId,
      alertId,
      organizationId: input.organizationId,
      patientId: input.patientId,
      patientName: input.patientName,
      actorName: input.actorName,

      inputEventId: input.inputEventId!,
      inputType: input.inputType,
      sourceType: input.sourceType,

      triggerTimestamp: input.triggerTimestamp,
      triggerSummary: input.triggerSummary ?? '',

      triggerSummaryTemplateCode: input.triggerSummaryTemplateCode,
      triggerSummaryParams: input.triggerSummaryParams,

      evidencePayload: input.evidencePayload,

      priority: input.priority ?? 'P2',
      alertState: 'UNASSIGNED',

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

      // 🔹 SLA (basic default, can be enhanced)
      assignSlaMinutes: 0,
      resolveSlaMinutes: 0,
      assignSlaDueAt: now,
      resolveSlaDueAt: now,
      slaBreachIndicator: false,

      // 🔹 Workflow
      statusUpdatedAt: now,
      statusUpdatedBy: input.actorUserId,

      closureComment: undefined,
      resolutionCode: undefined,
      dismissReason: undefined,

      // 🔹 Audit
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorUserId,
      updatedBy: input.actorUserId,

      // 🔹 GSIs
      gsi1pk: AlertKeyBuilder.toOrgPartitionKey(input.organizationId),
      gsi1sk: AlertKeyBuilder.buildGsi1Sk(
        'UNASSIGNED',
        input.priority ?? 'P2',
        input.triggerTimestamp,
        alertId,
      ),

      gsi2pk: undefined,
      gsi2sk: undefined,

      gsi3pk: AlertKeyBuilder.toPatPartitionKey(input.patientId),
      gsi3sk: AlertKeyBuilder.toTimestampSortKey(now),

      gsi4pk: AlertKeyBuilder.toGroupPartitionKey(groupingKey),
      gsi4sk: AlertKeyBuilder.toTimestampSortKey(now),

      gsi5pk: AlertKeyBuilder.toSlaPartitionKey(now),
      gsi5sk: AlertKeyBuilder.toSlaSortKey(now, alertId),
    };
  }

  // -----------------------------
  // Activity Record
  // -----------------------------
  static buildCreateActivity(ctx: CreateAlertContext) {
    const { alertId, now, input } = ctx;
    const activityId = randomUUID();
    return {
      TableName: process.env.ALERT_TABLE!,

      pk: AlertKeyBuilder.toAlertPk(alertId),
      sk: `ACTIVITY#${now}#${activityId}`,

      entityType: 'ALERT_ACTIVITY',

      activityId,
      alertId,

      activityType: 'AlertCreated',
      activityTimestamp: now,

      performedBy: input.actorUserId ?? 'SYSTEM',
      performedByDisplayName: input.actorName,

      activityComment: 'Alert created',

      previousState: undefined,
      newState: 'UNASSIGNED',

      previousPriority: undefined,
      newPriority: input.priority ?? 'P2',

      previousAssignee: undefined,
      newAssignee: undefined,

      evidencePayload: input.evidencePayload,

      createdAt: now,
      updatedAt: now,
      organizationId: input.organizationId,
    };
  }

  // -----------------------------
  // Event (Idempotency)
  // -----------------------------
  static buildEvent(ctx: CreateAlertContext) {
    const { input, alertId, now } = ctx;

    return {
      TableName: process.env.ALERT_TABLE!,

      pk: `EVENT#${input.inputEventId}`,
      sk: ALERT_METADATA_SK,

      entityType: 'ALERT_EVENT',

      alertId,
      organizationId: input.organizationId,

      createdAt: now,
    };
  }

  /**
   * Base-table row: `pk = GROUP#<groupingKey>`, `sk = Alert#<triggerTimestamp>#<alertId>`.
   * Written in the same transact as create; use {@link AlertRepository.queryAlertsByGroupingKey} to load alerts.
   */
  static buildGroupMembershipPut(ctx: CreateAlertContext) {
    const { alertId, now, input, groupingKey } = ctx;

    return {
      Put: {
        TableName: process.env.ALERT_TABLE!,
        Item: {
          pk: AlertKeyBuilder.toGroupPartitionKey(groupingKey),
          sk: AlertKeyBuilder.buildGroupMembershipSk(input.triggerTimestamp, alertId),
          entityType: 'ALERT_GROUP_MEMBER',
          alertId,
          groupingKey,
          organizationId: input.organizationId,
          createdAt: now,
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
      alertState: 'UNASSIGNED',
      createdAt: ctx.now,
    };
  }

  static buildUpdateExpression(
    existing: AlertDdbRecord,
    patch: UpdateAlertRequest,
  ) {
    const now = new Date().toISOString();
  
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
      setField('statusUpdatedAt', now);
  
      if (existing.priority && existing.triggerTimestamp) {
        setField(
          'gsi1sk',
          `STATE#${patch.alertState}#PRIORITY#${existing.priority}#TS#${existing.triggerTimestamp}#${existing.alertId}`,
        );
  
        if (existing.assignedToUserId) {
          setField(
            'gsi2sk',
            `STATE#${patch.alertState}#TS#${existing.triggerTimestamp}#${existing.alertId}`,
          );
        }
      }
    }
  
    if (patch.assignedToUserId !== undefined) {
      if (patch.assignedToUserId === null) {
        removeField('assignedToUserId');
        removeField('assignedAt');
        removeField('assignedBy');
        removeField('gsi2pk');
        removeField('gsi2sk');
      } else {
        setField('assignedToUserId', patch.assignedToUserId);
        setField('assignedAt', now);
        setField('assignedBy', patch.assignedToUserId);
  
        setField('gsi2pk', `USER#${patch.assignedToUserId}`);
  
        if (existing.triggerTimestamp) {
          setField(
            'gsi2sk',
            `STATE#${patch.alertState ?? existing.alertState}#TS#${existing.triggerTimestamp}#${existing.alertId}`,
          );
        }
      }
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
  
    setField('updatedAt', now);
  
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
}