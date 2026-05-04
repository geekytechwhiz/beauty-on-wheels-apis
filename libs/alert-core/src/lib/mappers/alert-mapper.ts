import type { Alert } from '../models/domain/alert.model';
import type { AlertAggregate } from '../models/domain/alert-aggregate';
import type { AlertAssignment } from '../models/domain/alert-assignment.model';
import type { AlertSla } from '../models/domain/alert-sla.model';
import type { AlertWorkflow } from '../models/domain/alert-workflow.model';

import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';

import type { AlertListItem } from '../models/read-models/alert-list-item.model';
import type { AlertGroupView } from '../models/read-models/alert-group-view.model';

import { toEpochMs } from '../utils/alert-time';

export class AlertMapper {
  /**
   * Domain → Persistence
   */
  static toDdb(aggregate: AlertAggregate): AlertDdbRecord {
    const { alert, assignment, sla, workflow } = aggregate;

    return {
      ...alert,
      ...assignment,
      ...sla,
      ...workflow,

      // ⚠️ These MUST be injected by builder (not mapper ideally)
      pk: '',
      sk: '',
      entityType: 'ALERT',

      gsi1pk: '',
      gsi1sk: '',
      gsi2pk: assignment.assignedToUserId ? '' : undefined,
      gsi2sk: assignment.assignedToUserId ? '' : undefined,
      gsi3pk: '',
      gsi3sk: '',
      gsi5pk: '',
      gsi5sk: '',
    };
  }

  /**
   * Persistence → Domain
   */
  static fromDdb(record: AlertDdbRecord): AlertAggregate {
    const alert: Alert = {
      id: record.id,
      organizationId: record.organizationId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      createdBy: record.createdBy,
      updatedBy: record.updatedBy,

      alertId: record.alertId,
      patientId: record.patientId,
      patientName: record.patientName,
      actorName: record.actorName,

      inputEventId: record.inputEventId,
      inputType: record.inputType,
      sourceType: record.sourceType,

      triggerTimestamp: record.triggerTimestamp,

      triggerSummary: record.triggerSummary,
      triggerSummaryTemplateCode: record.triggerSummaryTemplateCode,
      triggerSummaryParams: record.triggerSummaryParams,

      evidencePayload: record.evidencePayload,

      priority: record.priority,
      alertState: record.alertState,

      groupingKey: record.groupingKey,

      appliesToType: record.appliesToType,
      linkedEntityCode: record.linkedEntityCode,
      severityHint: record.severityHint,

      carePlanInstanceId: record.carePlanInstanceId,
      packageAssignmentId: record.packageAssignmentId,

      alertPolicyTemplateVersionId: record.alertPolicyTemplateVersionId,
      thresholdTemplateVersionId: record.thresholdTemplateVersionId,
    };

    const assignment: AlertAssignment = {
      assignedToUserId: record.assignedToUserId,
      assignedAt: record.assignedAt,
      assignedBy: record.assignedBy,
    };

    const sla: AlertSla = {
      assignSlaMinutes: record.assignSlaMinutes,
      resolveSlaMinutes: record.resolveSlaMinutes,
      assignSlaDueAt: record.assignSlaDueAt,
      resolveSlaDueAt: record.resolveSlaDueAt,
      slaBreachIndicator: record.slaBreachIndicator ?? false,
      assignSlaBreachedAt: record.assignSlaBreachedAt,
      resolveSlaBreachedAt: record.resolveSlaBreachedAt,
    };

    const workflow: AlertWorkflow = {
      alertState: record.alertState,
      statusUpdatedAt: record.statusUpdatedAt,
      statusUpdatedBy: record.statusUpdatedBy,
      closureComment: record.closureComment,
      resolutionCode: record.resolutionCode,
      dismissReason: record.dismissReason,
    };

    return {
      alert,
      assignment,
      sla,
      workflow,
    };
  }

  /**
   * Domain → API List Item
   */
  static toListItem(aggregate: AlertAggregate): AlertListItem {
    const { alert, assignment, sla } = aggregate;

    return {
      alertId: alert.alertId,
      patientId: alert.patientId,

      priority: alert.priority,
      alertState: alert.alertState,

      triggerSummary: alert.triggerSummary,
      triggerTimestamp: toEpochMs(alert.triggerTimestamp),

      assignedToUserId: assignment.assignedToUserId,

      slaDueAt: sla.resolveSlaDueAt != null ? toEpochMs(sla.resolveSlaDueAt) : undefined,
      slaBreachIndicator: sla.slaBreachIndicator,
    };
  }

  /**
   * Persistence → API List Item (fast path, avoids full mapping)
   */
  static toListItemFromDdb(record: AlertDdbRecord): AlertListItem {
    return {
      alertId: record.alertId,
      patientId: record.patientId,

      priority: record.priority,
      alertState: record.alertState,

      triggerSummary: record.triggerSummary,
      triggerTimestamp: toEpochMs(record.triggerTimestamp),

      assignedToUserId: record.assignedToUserId,

      slaDueAt: record.resolveSlaDueAt != null ? toEpochMs(record.resolveSlaDueAt) : undefined,
      slaBreachIndicator: record.slaBreachIndicator,
    };
  }

  /**
   * Persistence → Group View
   */
  static toGroupView(records: AlertDdbRecord[]): AlertGroupView {
    if (!records.length) {
      throw new Error('Cannot build group view from empty records');
    }

    const sorted = [...records].sort((a, b) => toEpochMs(b.triggerTimestamp) - toEpochMs(a.triggerTimestamp));

    const highestPriority = records.reduce((acc, r) => {
      return r.priority < acc ? r.priority : acc;
    }, records[0].priority);

    const breachedCount = records.filter((r) => r.slaBreachIndicator).length;

    return {
      groupingKey: records[0].groupingKey,
      patientId: records[0].patientId,

      highestPriority,

      openRecordCount: records.length,
      breachedRecordCount: breachedCount,

      latestAlertTimestamp: toEpochMs(sorted[0].triggerTimestamp),

      assignedToUserId: records[0].assignedToUserId,

      alertState: records[0].alertState,
    };
  }
}