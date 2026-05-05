import type { AlertState } from '../models/types/alert-state.type';

import { padEpochMs13, slaDateBucketUtcFromMs } from '../utils/alert-time';

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

  /** Sort-key segment: `TS#` + zero-padded epoch ms (string order = time order). */
  static toTimestampSortKey(epochMs: number): string {
    return `TS#${padEpochMs13(epochMs)}`;
  }

  static toActivitySortKey(epochMs: number, activityId: string): string {
    return `ACTIVITY#${padEpochMs13(epochMs)}#${activityId}`;
  }

  /** Base-table sort key: `GROUP#<groupingKey>` partition member linking to an alert. */
  static buildGroupMembershipSk(triggerEpochMs: number, alertId: string): string {
    return `Alert#${padEpochMs13(triggerEpochMs)}#${alertId.trim()}`;
  }

  /** GSI1 partition: org + workflow state (team queue). */
  static buildGsi1Pk(organizationId: string, alertState: AlertState): string {
    return `${this.toOrgPartitionKey(organizationId)}#STATE#${alertState}`;
  }

  /** GSI1 sort: time-ordered under `TS#` prefix (trigger instant, epoch ms). */
  static buildGsi1Sk(triggerEpochMs: number): string {
    return this.toTimestampSortKey(triggerEpochMs);
  }

  static toGsi3Sk(epochMs: number): string {
    return this.toTimestampSortKey(epochMs);
  }

  /** GSI4 partition: org-wide index (no `STATE#` segment). */
  static buildGsi4Pk(organizationId: string): string {
    return this.toOrgPartitionKey(organizationId);
  }

  /** GSI4 sort: trigger instant + `alertId` (newest-first per org when `ScanIndexForward: false`). */
  static buildGsi4Sk(triggerEpochMs: number, alertId: string): string {
    return `TS#${padEpochMs13(triggerEpochMs)}#${alertId.trim()}`;
  }

  /** GSI2 (“my queue”) sort key — same segment shape as {@link buildGsi4Sk}; workflow state is `alertState` on the item. */
  static buildGsi2Sk(triggerEpochMs: number, alertId: string): string {
    return this.buildGsi4Sk(triggerEpochMs, alertId);
  }

  static toSlaPartitionKey(epochMs: number): string {
    return `SLA#${slaDateBucketUtcFromMs(epochMs)}`;
  }

  static toSlaSortKey(dueEpochMs: number, alertId: string): string {
    return `TS#${padEpochMs13(dueEpochMs)}#${alertId}`;
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
