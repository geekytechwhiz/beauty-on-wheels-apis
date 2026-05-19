import { ALERT_STATE, AlertActivityType, type AlertDdbRecord, type AlertPublishIntent } from '@api-hub/alert-core';

import { minimalAlertRecord } from '../../../__tests__/handler-test-utils';

export { minimalAlertRecord };

const OCCURRED_AT = '2026-01-15T12:00:00.000Z';

export function baseIntentFields(record: AlertDdbRecord) {
  return {
    alertId: record.alertId,
    organizationId: record.organizationId,
    patientId: record.patientId,
    performedBy: 'actor-1',
    performedByDisplayName: 'Actor One',
    occurredAt: OCCURRED_AT,
  };
}

export function createdIntent(record?: AlertDdbRecord): AlertPublishIntent {
  return { kind: 'CREATED', record: record ?? minimalAlertRecord() };
}

export function assignmentChangedIntent(record?: AlertDdbRecord): AlertPublishIntent {
  return {
    kind: 'ASSIGNMENT_CHANGED',
    ...baseIntentFields(record ?? minimalAlertRecord()),
    activityType: AlertActivityType.AlertAssigned,
    newAssignee: 'user-2',
    newAssigneeDisplayName: 'User Two',
  };
}

export function stateChangedIntent(record?: AlertDdbRecord): AlertPublishIntent {
  return {
    kind: 'STATE_CHANGED',
    ...baseIntentFields(record ?? minimalAlertRecord()),
    activityType: AlertActivityType.AlertStateChanged,
    previousState: ALERT_STATE.ASSIGNED,
    newState: ALERT_STATE.IN_PROGRESS,
  };
}

export function resolvedIntent(record?: AlertDdbRecord): AlertPublishIntent {
  return {
    kind: 'RESOLVED',
    ...baseIntentFields(record ?? minimalAlertRecord()),
    previousState: ALERT_STATE.IN_PROGRESS,
    newState: ALERT_STATE.RESOLVED,
    activityComment: 'Resolved',
  };
}

export function dismissedIntent(record?: AlertDdbRecord): AlertPublishIntent {
  return {
    kind: 'DISMISSED',
    ...baseIntentFields(record ?? minimalAlertRecord()),
    previousState: ALERT_STATE.UNASSIGNED,
    newState: ALERT_STATE.DISMISSED,
    activityComment: 'Dismissed',
  };
}

export function priorityChangedIntent(record?: AlertDdbRecord): AlertPublishIntent {
  return {
    kind: 'PRIORITY_CHANGED',
    ...baseIntentFields(record ?? minimalAlertRecord()),
    previousPriority: 'P2',
    newPriority: 'P0',
  };
}

export function noteAddedIntent(record?: AlertDdbRecord): AlertPublishIntent {
  const r = record ?? minimalAlertRecord();
  return {
    kind: 'NOTE_ADDED',
    alertId: r.alertId,
    organizationId: r.organizationId,
    patientId: r.patientId,
    activity: {
      activityId: 'act-1',
      activityType: AlertActivityType.NoteAdded,
      activityTimestamp: Date.parse('2026-01-15T11:00:00.000Z'),
      activityComment: 'Note text',
      performedBy: 'actor-1',
      performedByDisplayName: 'Actor One',
    },
  };
}

export const alertCreateIngestSample = {
  organizationId: 'org-1',
  inputEventId: 'threshold-evt-1',
  inputType: 'THRESHOLD_BREACH',
  sourceType: 'MONITORING_SERVICE',
  patientId: 'pat-1',
  patientName: 'Jane Doe',
  triggerTimestamp: Date.parse('2026-01-15T10:00:00.000Z'),
  evidencePayload: {
    metric: 'BP_SYSTOLIC',
    currentValue: 190,
    threshold: 140,
    severityHint: 'CRITICAL',
  },
  priority: 'P0',
  groupingKey: 'pat-1|BP|OPEN',
  appliesToType: 'VITAL_SIGN',
  linkedEntityCode: 'BP_SYSTOLIC',
  severityHint: 'CRITICAL',
};

export const missedReadingIngestSample = {
  organizationId: 'org-1',
  inputEventId: 'missed-evt-1',
  inputType: 'MISSED_READING',
  sourceType: 'DEVICE_MONITORING',
  patientId: 'pat-1',
  patientName: 'Jane Doe',
  triggerTimestamp: Date.parse('2026-01-15T10:00:00.000Z'),
  evidencePayload: {
    readingType: 'BLOOD_PRESSURE',
    linkedEntityCode: 'BP_SYSTOLIC',
    lastSuccessfulReadingTimestamp: Date.parse('2026-01-14T09:00:00.000Z'),
    missedDuration: '24h',
  },
  priority: 'P2',
  groupingKey: 'pat-1|BP|OPEN',
  appliesToType: 'VITAL_SIGN',
};
