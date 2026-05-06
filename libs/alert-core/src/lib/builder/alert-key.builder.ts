import type { AlertState } from '../models/types/alert-state.type';
import type { PriorityBand } from '../models/types/priority-band.type';

export class AlertKeyBuilder {
  static toAlertPk(alertId: string): string {
    return `ALERT#${alertId}`;
  }

  static toEventPk(eventId: string): string {
    return `EVENT#${eventId}`;
  }

  static toGroupPartitionKey(groupingKey: string): string {
    return `GROUP#${groupingKey}`;
  }

  static toOrgPartitionKey(organizationId: string): string {
    const id = organizationId.trim();
    return id.startsWith('ORG#') ? id : `ORG#${id}`;
  }

  static toPatPartitionKey(patientId: string): string {
    const id = patientId.trim();
    return id.startsWith('PAT#') ? id : `PAT#${id}`;
  }

  static toUserPartitionKey(userId: string): string {
    const id = userId.trim();
    return id.startsWith('USER#') ? id : `USER#${id}`;
  }

  static toTimestampSortKey(ts: string): string {
    return `TS#${ts}`;
  }

  static toActivitySortKey(ts: string, activityId: string): string {
    return `ACTIVITY#${ts}#${activityId}`;
  }

  /** Base-table sort key: `GROUP#<groupingKey>` partition member linking to an alert. */
  static buildGroupMembershipSk(triggerTimestamp: string, alertId: string): string {
    return `Alert#${triggerTimestamp.trim()}#${alertId.trim()}`;
  }

  static buildGsi1Sk(
    state: AlertState,
    priority: PriorityBand,
    triggerTimestamp: string,
    alertId: string,
  ): string {
    return `STATE#${state}#PRIORITY#${priority}#TS#${triggerTimestamp}#${alertId}`;
  }

  static buildGsi2Sk(
    state: AlertState,
    triggerTimestamp: string,
    alertId: string,
  ): string {
    return `STATE#${state}#TS#${triggerTimestamp}#${alertId}`;
  }

  static toGsi3Sk(triggerTimestamp: string): string {
    return this.toTimestampSortKey(triggerTimestamp);
  }

  static toGsi4Sk(triggerTimestamp: string): string {
    return this.toTimestampSortKey(triggerTimestamp);
  }

  static toSlaPartitionKey(iso: string): string {
    return `SLA#${this.slaDateBucketUtc(iso)}`;
  }

  static toSlaSortKey(dueAt: string, alertId: string): string {
    return `TS#${dueAt}#${alertId}`;
  }

  static slaDateBucketUtc(iso: string): string {
    return iso.slice(0, 10);
  }

  static buildDefaultGroupingKey(params: {
    patientId: string;
    inputType: string;
    linkedEntityCode?: string;
    severityHint?: string;
  }): string {
    const pat = this.toPatPartitionKey(params.patientId);

    const parts = [
      pat,
      params.inputType,
      params.linkedEntityCode ?? 'GENERIC',
      params.severityHint ?? 'NORMAL',
    ];

    return parts.join('|');
  }
}