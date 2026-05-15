import { AlertEntityBuilder } from '../builder/alert-entity.builder';
import { AlertActivityType } from '../constants/alert-activity-type';
import type { AlertPublishIntent } from '../models/events/alert-publish-intent';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import type { UpdateAlertRequest } from '../models/api/update-alert.request';
import type { AlertState } from '../models/types/alert-state.type';
import type { PriorityBand } from '../models/types/priority-band.type';

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function activityItemToIntent(
  existing: AlertDdbRecord,
  item: Record<string, unknown>,
  occurredAt: string,
): AlertPublishIntent | null {
  const activityType = String(item.activityType ?? '');
  const performedBy = String(item.performedBy ?? 'SYSTEM');
  const performedByDisplayName =
    typeof item.performedByDisplayName === 'string' ? item.performedByDisplayName : undefined;
  const base = {
    alertId: existing.alertId,
    organizationId: existing.organizationId,
    patientId: existing.patientId,
    performedBy,
    performedByDisplayName,
    occurredAt,
  };

  if (activityType === AlertActivityType.AlertAssigned || activityType === AlertActivityType.AlertReassigned) {
    return {
      kind: 'ASSIGNMENT_CHANGED',
      ...base,
      activityType: activityType as
        | AlertActivityType.AlertAssigned
        | AlertActivityType.AlertReassigned,
      previousAssignee:
        typeof item.previousAssignee === 'string' ? item.previousAssignee : undefined,
      newAssignee: typeof item.newAssignee === 'string' ? item.newAssignee : undefined,
      previousAssigneeDisplayName:
        typeof item.previousAssigneeDisplayName === 'string'
          ? item.previousAssigneeDisplayName
          : undefined,
      newAssigneeDisplayName:
        typeof item.newAssigneeDisplayName === 'string' ? item.newAssigneeDisplayName : undefined,
    };
  }

  if (activityType === AlertActivityType.AlertResolved) {
    return {
      kind: 'RESOLVED',
      ...base,
      previousState: item.previousState as AlertState,
      newState: item.newState as AlertState,
      activityComment:
        typeof item.activityComment === 'string' ? item.activityComment : undefined,
    };
  }

  if (activityType === AlertActivityType.AlertDismissed) {
    return {
      kind: 'DISMISSED',
      ...base,
      previousState: item.previousState as AlertState,
      newState: item.newState as AlertState,
      activityComment:
        typeof item.activityComment === 'string' ? item.activityComment : undefined,
    };
  }

  if (activityType === AlertActivityType.AlertStateChanged) {
    return {
      kind: 'STATE_CHANGED',
      ...base,
      activityType: AlertActivityType.AlertStateChanged,
      previousState: item.previousState as AlertState,
      newState: item.newState as AlertState,
    };
  }

  if (activityType === AlertActivityType.PriorityChanged) {
    return {
      kind: 'PRIORITY_CHANGED',
      ...base,
      previousPriority: item.previousPriority as PriorityBand,
      newPriority: item.newPriority as PriorityBand,
    };
  }

  return null;
}

/** Derive outbound publish intents from workflow/assignment activity rows (same inputs as DDB writes). */
export function buildPublishIntentsFromWorkflowUpdate(params: {
  existing: AlertDdbRecord;
  patch: UpdateAlertRequest;
  performedBy: string;
  performedByDisplayName?: string;
  nowMs: number;
}): AlertPublishIntent[] {
  const activityItems = AlertEntityBuilder.buildWorkflowActivityItems(params);
  return buildPublishIntentsFromActivityItems({
    existing: params.existing,
    activityItems,
    occurredAtMs: params.nowMs,
  });
}

export function buildPublishIntentsFromActivityItems(params: {
  existing: AlertDdbRecord;
  activityItems: Record<string, unknown>[];
  occurredAtMs: number;
}): AlertPublishIntent[] {
  const occurredAt = toIso(params.occurredAtMs);
  const intents: AlertPublishIntent[] = [];

  for (const item of params.activityItems) {
    const intent = activityItemToIntent(params.existing, item, occurredAt);
    if (intent) intents.push(intent);
  }

  return intents;
}

export function buildPriorityChangedIntent(params: {
  existing: AlertDdbRecord;
  newPriority: PriorityBand;
  performedBy: string;
  performedByDisplayName?: string;
  nowMs: number;
}): AlertPublishIntent {
  return {
    kind: 'PRIORITY_CHANGED',
    alertId: params.existing.alertId,
    organizationId: params.existing.organizationId,
    patientId: params.existing.patientId,
    previousPriority: params.existing.priority,
    newPriority: params.newPriority,
    performedBy: params.performedBy,
    performedByDisplayName: params.performedByDisplayName,
    occurredAt: toIso(params.nowMs),
  };
}

export function buildCreatePublishIntents(record: AlertDdbRecord): AlertPublishIntent[] {
  return [{ kind: 'CREATED', record }];
}
