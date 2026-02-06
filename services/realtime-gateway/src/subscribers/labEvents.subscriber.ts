import type { EventBridgeHandler } from 'aws-lambda';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import { createWebSocketEvent } from '../models/websocketEvent';
import { deliverToOrg } from '../services/realtime.service';

const baseLogger = createLogger({ service: 'realtime-gateway', redactPII: true });

type LabEventDetailType = 'LAB_SAMPLE_COLLECTED' | 'LAB_REPORT_READY' | 'LAB_ORDER_STATUS_UPDATED';

interface LabEventDetail {
  orgId?: string;
  labOrderId?: string;
  entityId?: string;
  status?: string;
  [key: string]: unknown;
}

function toWebSocketType(detailType: string): string {
  return detailType;
}

function toUiPayload(detail: LabEventDetail, detailType: string): Record<string, unknown> {
  return {
    status: detail.status ?? 'UPDATED',
    labOrderId: detail.labOrderId ?? detail.entityId,
    ...(detailType === 'LAB_REPORT_READY' && { reportReady: true }),
  };
}

export const main: EventBridgeHandler<LabEventDetailType, LabEventDetail, void> = async (event) => {
  const detail = typeof event.detail === 'string' ? (JSON.parse(event.detail) as LabEventDetail) : event.detail;
  const detailType = event['detail-type'];
  const orgId = detail.orgId;
  const logger = createChildLogger(baseLogger, {
    eventType: detailType,
    orgId,
    labOrderId: detail.labOrderId ?? detail.entityId,
  });

  if (!orgId) {
    logger.warn({ event: 'lab_subscriber_skipped', reason: 'missing_orgId' });
    return;
  }

  try {
    const wsEvent = createWebSocketEvent(
      toWebSocketType(detailType),
      detail.labOrderId ?? detail.entityId ?? 'unknown',
      toUiPayload(detail, detailType)
    );
    await deliverToOrg(orgId, wsEvent, logger);
  } catch (err) {
    logger.error({ event: 'lab_subscriber_delivery_error', err: serializeError(err) });
  }
};
