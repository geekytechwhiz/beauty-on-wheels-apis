import type { AlertActivity } from '../domain/alert-activity.model';
import type { AlertDdbRecord } from '../persistence/alert-ddb.model';
import type { AlertState } from '../types/alert-state.type';
import type { PriorityBand } from '../types/priority-band.type';
import { AlertActivityType } from '../../constants/alert-activity-type';

export type AlertPublishIntent =
  | AlertPublishIntentCreated
  | AlertPublishIntentAssignmentChanged
  | AlertPublishIntentStateChanged
  | AlertPublishIntentResolved
  | AlertPublishIntentDismissed
  | AlertPublishIntentPriorityChanged
  | AlertPublishIntentNoteAdded;

export interface AlertPublishIntentCreated {
  kind: 'CREATED';
  record: AlertDdbRecord;
}

export interface AlertPublishIntentAssignmentChanged {
  kind: 'ASSIGNMENT_CHANGED';
  alertId: string;
  organizationId: string;
  patientId: string;
  activityType: AlertActivityType.AlertAssigned | AlertActivityType.AlertReassigned;
  previousAssignee?: string;
  newAssignee?: string;
  previousAssigneeDisplayName?: string;
  newAssigneeDisplayName?: string;
  performedBy: string;
  performedByDisplayName?: string;
  occurredAt: string;
}

export interface AlertPublishIntentStateChanged {
  kind: 'STATE_CHANGED';
  alertId: string;
  organizationId: string;
  patientId: string;
  activityType: AlertActivityType.AlertStateChanged;
  previousState: AlertState;
  newState: AlertState;
  performedBy: string;
  performedByDisplayName?: string;
  occurredAt: string;
}

export interface AlertPublishIntentResolved {
  kind: 'RESOLVED';
  alertId: string;
  organizationId: string;
  patientId: string;
  previousState: AlertState;
  newState: AlertState;
  performedBy: string;
  performedByDisplayName?: string;
  activityComment?: string;
  occurredAt: string;
}

export interface AlertPublishIntentDismissed {
  kind: 'DISMISSED';
  alertId: string;
  organizationId: string;
  patientId: string;
  previousState: AlertState;
  newState: AlertState;
  performedBy: string;
  performedByDisplayName?: string;
  activityComment?: string;
  occurredAt: string;
}

export interface AlertPublishIntentPriorityChanged {
  kind: 'PRIORITY_CHANGED';
  alertId: string;
  organizationId: string;
  patientId: string;
  previousPriority: PriorityBand;
  newPriority: PriorityBand;
  performedBy: string;
  performedByDisplayName?: string;
  occurredAt: string;
}

export interface AlertPublishIntentNoteAdded {
  kind: 'NOTE_ADDED';
  activity: AlertActivity;
  alertId: string;
  organizationId: string;
  patientId: string;
}
