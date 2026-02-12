import type { EventBridgeHandler } from 'aws-lambda';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import { isCanonicalLabEventType, type CanonicalLabEventType } from '@api-hub/integration-events';
import { createWebSocketEvent } from '../models/websocketEvent';
import { deliverToOrg } from '../services/realtime.service';

const baseLogger = createLogger({ service: 'realtime-gateway', redactPII: true });

const LAB_PREFIX = 'LAB_';

/** Lab event detail-types: canonical (from integration-events) prefixed with LAB_ for routing, plus order status */
type LabEventDetailType =
  | 'LAB_SAMPLE_COLLECTED'
  | 'LAB_SAMPLE_RECEIVED'
  | 'LAB_REPORT_READY'
  | 'LAB_BOOKING_CANCELLED'
  | 'LAB_ORDER_STATUS_UPDATED';

interface LabEventDetail {
  orgId?: string;
  labOrderId?: string;
  entityId?: string;
  status?: string;
  [key: string]: unknown;
}

/** Maps event detail-type to canonical type when possible for consistent handling */
function toCanonicalEventType(detailType: string): string {
  if (detailType.startsWith(LAB_PREFIX)) {
    const candidate = detailType.slice(LAB_PREFIX.length) as CanonicalLabEventType;
    if (isCanonicalLabEventType(candidate)) return candidate;
  }
  return detailType;
}

function toWebSocketType(detailType: string): string {
  return detailType;
}

function toUiPayload(detail: LabEventDetail, detailType: string): Record<string, unknown> {
  const canonicalType = toCanonicalEventType(detailType);
  return {
    status: detail.status ?? 'UPDATED',
    labOrderId: detail.labOrderId ?? detail.entityId,
    ...(isCanonicalLabEventType(canonicalType) && canonicalType === 'REPORT_READY' && { reportReady: true }),
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
