import type { AlertPublishIntent } from '@api-hub/alert-core';
import type { AlertDdbRecord } from '@api-hub/alert-core';
import { z } from 'zod';

import { AlertAssignmentChangedEventSchema } from '../outbound/alert-assignment-changed.event';
import { AlertCreatedEventSchema } from '../outbound/alert-created.event';
import { AlertDismissedEventSchema } from '../outbound/alert-dismissed.event';
import { AlertNoteAddedEventSchema } from '../outbound/alert-note-added.event';
import { AlertPriorityChangedEventSchema } from '../outbound/alert-priority-changed.event';
import { AlertResolvedEventSchema } from '../outbound/alert-resolved.event';
import { AlertStateChangedEventSchema } from '../outbound/alert-state-changed.event';

export type AlertCreatedPayload = z.infer<typeof AlertCreatedEventSchema>;
export type AlertAssignmentChangedPayload = z.infer<typeof AlertAssignmentChangedEventSchema>;
export type AlertStateChangedPayload = z.infer<typeof AlertStateChangedEventSchema>;
export type AlertResolvedPayload = z.infer<typeof AlertResolvedEventSchema>;
export type AlertDismissedPayload = z.infer<typeof AlertDismissedEventSchema>;
export type AlertPriorityChangedPayload = z.infer<typeof AlertPriorityChangedEventSchema>;
export type AlertNoteAddedPayload = z.infer<typeof AlertNoteAddedEventSchema>;


function createdAtIso(record: AlertDdbRecord): string {
  if (typeof record.createdAt === 'number') {
    return new Date(record.createdAt).toISOString();
  }
  return new Date().toISOString();
}

export function mapAlertCreatedPayload(record: AlertDdbRecord): AlertCreatedPayload {
  return {
    alertId: record.alertId,
    patientId: record.patientId,
    organizationId: record.organizationId,
    priority: record.priority,
    state: record.alertState,
    createdAt: createdAtIso(record),
  };
}

export function mapAlertAssignmentChangedPayload(
  intent: Extract<AlertPublishIntent, { kind: 'ASSIGNMENT_CHANGED' }>,
): AlertAssignmentChangedPayload {
  return {
    alertId: intent.alertId,
    patientId: intent.patientId,
    organizationId: intent.organizationId,
    activityType: intent.activityType,
    previousAssignee: intent.previousAssignee,
    newAssignee: intent.newAssignee,
    previousAssigneeDisplayName: intent.previousAssigneeDisplayName,
    newAssigneeDisplayName: intent.newAssigneeDisplayName,
    performedBy: intent.performedBy,
    performedByDisplayName: intent.performedByDisplayName,
    occurredAt: intent.occurredAt,
  };
}

export function mapAlertStateChangedPayload(
  intent: Extract<AlertPublishIntent, { kind: 'STATE_CHANGED' }>,
): AlertStateChangedPayload {
  return {
    alertId: intent.alertId,
    patientId: intent.patientId,
    organizationId: intent.organizationId,
    activityType: intent.activityType,
    previousState: intent.previousState,
    currentState: intent.newState,
    performedBy: intent.performedBy,
    performedByDisplayName: intent.performedByDisplayName,
    occurredAt: intent.occurredAt,
  };
}

export function mapAlertResolvedPayload(
  intent: Extract<AlertPublishIntent, { kind: 'RESOLVED' }>,
): AlertResolvedPayload {
  return {
    alertId: intent.alertId,
    patientId: intent.patientId,
    organizationId: intent.organizationId,
    previousState: intent.previousState,
    currentState: intent.newState,
    performedBy: intent.performedBy,
    performedByDisplayName: intent.performedByDisplayName,
    activityComment: intent.activityComment,
    occurredAt: intent.occurredAt,
  };
}

export function mapAlertDismissedPayload(
  intent: Extract<AlertPublishIntent, { kind: 'DISMISSED' }>,
): AlertDismissedPayload {
  return {
    alertId: intent.alertId,
    patientId: intent.patientId,
    organizationId: intent.organizationId,
    previousState: intent.previousState,
    currentState: intent.newState,
    performedBy: intent.performedBy,
    performedByDisplayName: intent.performedByDisplayName,
    activityComment: intent.activityComment,
    occurredAt: intent.occurredAt,
  };
}

export function mapAlertPriorityChangedPayload(
  intent: Extract<AlertPublishIntent, { kind: 'PRIORITY_CHANGED' }>,
): AlertPriorityChangedPayload {
  return {
    alertId: intent.alertId,
    patientId: intent.patientId,
    organizationId: intent.organizationId,
    previousPriority: intent.previousPriority,
    newPriority: intent.newPriority,
    performedBy: intent.performedBy,
    performedByDisplayName: intent.performedByDisplayName,
    occurredAt: intent.occurredAt,
  };
}

export function mapAlertNoteAddedPayload(
  intent: Extract<AlertPublishIntent, { kind: 'NOTE_ADDED' }>,
): AlertNoteAddedPayload {
  const ts = intent.activity.activityTimestamp;
  return {
    alertId: intent.alertId,
    patientId: intent.patientId,
    organizationId: intent.organizationId,
    activityId: intent.activity.activityId,
    comment: intent.activity.activityComment ?? '',
    performedBy: intent.activity.performedBy,
    performedByDisplayName: intent.activity.performedByDisplayName,
    occurredAt: typeof ts === 'number' ? new Date(ts).toISOString() : new Date().toISOString(),
  };
}
