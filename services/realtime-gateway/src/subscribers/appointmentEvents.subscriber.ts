import type { EventBridgeHandler } from 'aws-lambda';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import { createWebSocketEvent } from '../models/websocketEvent';
import { deliverToOrg } from '../services/realtime.service';

const baseLogger = createLogger({ service: 'realtime-gateway', redactPII: true });

interface AppointmentEventDetail {
  orgId?: string;
  appointmentId?: string;
  entityId?: string;
  status?: string;
  [key: string]: unknown;
}

export const main: EventBridgeHandler<'APPOINTMENT_UPDATED', AppointmentEventDetail, void> = async (event) => {
  const detail = typeof event.detail === 'string' ? (JSON.parse(event.detail) as AppointmentEventDetail) : event.detail;
  const orgId = detail.orgId;
  const logger = createChildLogger(baseLogger, {
    eventType: 'APPOINTMENT_UPDATED',
    orgId,
    appointmentId: detail.appointmentId ?? detail.entityId,
  });

  if (!orgId) {
    logger.warn({ event: 'appointment_subscriber_skipped', reason: 'missing_orgId' });
    return;
  }

  try {
    const wsEvent = createWebSocketEvent('APPOINTMENT_UPDATED', detail.appointmentId ?? detail.entityId ?? 'unknown', {
      status: detail.status ?? 'UPDATED',
      appointmentId: detail.appointmentId ?? detail.entityId,
    });
    await deliverToOrg(orgId, wsEvent, logger);
  } catch (err) {
    logger.error({ event: 'appointment_subscriber_delivery_error', err: serializeError(err) });
  }
};
