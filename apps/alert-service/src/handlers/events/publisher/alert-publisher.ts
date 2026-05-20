import type { AlertPublishIntent } from '@api-hub/alert-core';
import type { AlertDdbRecord } from '@api-hub/alert-core';
import type { Logger } from '@api-hub/observability';
import { getContext, recordPublishFailure } from '@api-hub/observability';
import { publishEvent } from '@api-hub/event-platform';

import {
  mapAlertAssignmentChangedPayload,
  mapAlertCreatedPayload,
  mapAlertDismissedPayload,
  mapAlertNoteAddedPayload,
  mapAlertPriorityChangedPayload,
  mapAlertResolvedPayload,
  mapAlertStateChangedPayload,
  type AlertAssignmentChangedPayload,
  type AlertDismissedPayload,
  type AlertNoteAddedPayload,
  type AlertPriorityChangedPayload,
  type AlertResolvedPayload,
  type AlertStateChangedPayload,
} from '../mappers/alert-publish.mapper';
import { AlertAssignmentChangedEventSchema } from '../outbound/alert-assignment-changed.event';
import { AlertCreatedEventSchema } from '../outbound/alert-created.event';
import { AlertDismissedEventSchema } from '../outbound/alert-dismissed.event';
import { AlertNoteAddedEventSchema } from '../outbound/alert-note-added.event';
import { AlertPriorityChangedEventSchema } from '../outbound/alert-priority-changed.event';
import { AlertResolvedEventSchema } from '../outbound/alert-resolved.event';
import { AlertStateChangedEventSchema } from '../outbound/alert-state-changed.event';

async function publishSafe(
  eventName: string,
  fn: () => Promise<void>,
  context: Record<string, unknown>,
  logger?: Logger,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    recordPublishFailure(eventName, error);
    logger?.warn({
      event: `${eventName}_publish_failed`,
      message: `${eventName} event publish failed after persistence`,
      ...context,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { name: 'UnknownError', message: String(error) },
    });
  }
}

function currentCorrelationId(fallback: string): string {
  const correlationId = getContext().correlationId;
  return correlationId && correlationId !== 'unknown' ? correlationId : fallback;
}

export async function publishAlertCreated(
  record: AlertDdbRecord,
  logger?: Logger,
): Promise<void> {
  const payload = mapAlertCreatedPayload(record);
  await publishSafe(
    'alert_created',
    () =>
      publishEvent(AlertCreatedEventSchema, payload, {
        meta: {
          correlationId: currentCorrelationId(payload.alertId),
          tenantId: payload.organizationId,
        },
      }),
    { alertId: payload.alertId, organizationId: payload.organizationId },
    logger,
  );
}

export async function publishAlertAssignmentChanged(
  payload: AlertAssignmentChangedPayload,
  logger?: Logger,
): Promise<void> {
  await publishSafe(
    'alert_assignment_changed',
    () =>
      publishEvent(AlertAssignmentChangedEventSchema, payload, {
        meta: {
          correlationId: currentCorrelationId(payload.alertId),
          tenantId: payload.organizationId,
        },
      }),
    { alertId: payload.alertId, organizationId: payload.organizationId },
    logger,
  );
}

export async function publishAlertStateChanged(
  payload: AlertStateChangedPayload,
  logger?: Logger,
): Promise<void> {
  await publishSafe(
    'alert_state_changed',
    () =>
      publishEvent(AlertStateChangedEventSchema, payload, {
        meta: {
          correlationId: currentCorrelationId(payload.alertId),
          tenantId: payload.organizationId,
        },
      }),
    { alertId: payload.alertId, organizationId: payload.organizationId },
    logger,
  );
}

export async function publishAlertResolved(
  payload: AlertResolvedPayload,
  logger?: Logger,
): Promise<void> {
  await publishSafe(
    'alert_resolved',
    () =>
      publishEvent(AlertResolvedEventSchema, payload, {
        meta: {
          correlationId: currentCorrelationId(payload.alertId),
          tenantId: payload.organizationId,
        },
      }),
    { alertId: payload.alertId, organizationId: payload.organizationId },
    logger,
  );
}

export async function publishAlertDismissed(
  payload: AlertDismissedPayload,
  logger?: Logger,
): Promise<void> {
  await publishSafe(
    'alert_dismissed',
    () =>
      publishEvent(AlertDismissedEventSchema, payload, {
        meta: {
          correlationId: currentCorrelationId(payload.alertId),
          tenantId: payload.organizationId,
        },
      }),
    { alertId: payload.alertId, organizationId: payload.organizationId },
    logger,
  );
}

export async function publishAlertPriorityChanged(
  payload: AlertPriorityChangedPayload,
  logger?: Logger,
): Promise<void> {
  await publishSafe(
    'alert_priority_changed',
    () =>
      publishEvent(AlertPriorityChangedEventSchema, payload, {
        meta: {
          correlationId: currentCorrelationId(payload.alertId),
          tenantId: payload.organizationId,
        },
      }),
    { alertId: payload.alertId, organizationId: payload.organizationId },
    logger,
  );
}

export async function publishAlertNoteAdded(
  payload: AlertNoteAddedPayload,
  logger?: Logger,
): Promise<void> {
  await publishSafe(
    'alert_note_added',
    () =>
      publishEvent(AlertNoteAddedEventSchema, payload, {
        meta: {
          correlationId: currentCorrelationId(payload.alertId),
          tenantId: payload.organizationId,
        },
      }),
    { alertId: payload.alertId, organizationId: payload.organizationId },
    logger,
  );
}

export async function publishAlertIntents(
  intents: AlertPublishIntent[],
  logger?: Logger,
): Promise<void> {
  for (const intent of intents) {
    switch (intent.kind) {
      case 'CREATED':
        await publishAlertCreated(intent.record, logger);
        break;
      case 'ASSIGNMENT_CHANGED':
        await publishAlertAssignmentChanged(mapAlertAssignmentChangedPayload(intent), logger);
        break;
      case 'STATE_CHANGED':
        await publishAlertStateChanged(mapAlertStateChangedPayload(intent), logger);
        break;
      case 'RESOLVED':
        await publishAlertResolved(mapAlertResolvedPayload(intent), logger);
        break;
      case 'DISMISSED':
        await publishAlertDismissed(mapAlertDismissedPayload(intent), logger);
        break;
      case 'PRIORITY_CHANGED':
        await publishAlertPriorityChanged(mapAlertPriorityChangedPayload(intent), logger);
        break;
      case 'NOTE_ADDED':
        await publishAlertNoteAdded(mapAlertNoteAddedPayload(intent), logger);
        break;
      default: {
        const _exhaustive: never = intent;
        void _exhaustive;
      }
    }
  }
}
