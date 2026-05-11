import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import { toEpochMs } from '../utils/alert-time';

/**
 * Maps a persisted alert row to the public API shape: strips Dynamo/GSI attributes and renames
 * `organizationId` → `orgId`, SLA minute fields → `assignSla` / `resolveSla`.
 * Instants are returned as Unix epoch milliseconds (legacy ISO string attributes are coerced).
 * Accepts optional legacy `TableName` on the row (never returned).
 */
export function toAlertDetail(r: AlertDdbRecord & { TableName?: string }) {
  const {
    pk,
    sk,
    gsi1pk,
    gsi1sk,
    gsi2pk,
    gsi2sk,
    gsi3pk,
    gsi3sk,
    gsi4pk,
    gsi4sk,
    gsi5pk,
    gsi5sk,
    entityType,
    organizationId,
    assignSlaMinutes,
    resolveSlaMinutes,
    TableName,
    triggerTimestamp,
    createdAt,
    updatedAt,
    assignedAt,
    assignSlaDueAt,
    resolveSlaDueAt,
    assignSlaBreachedAt,
    resolveSlaBreachedAt,
    statusUpdatedAt,
    ...rest
  } = r;

  return {
    ...rest,
    orgId: organizationId,
    assignSla: assignSlaMinutes,
    resolveSla: resolveSlaMinutes,
    triggerTimestamp: toEpochMs(triggerTimestamp),
    createdAt: toEpochMs(createdAt),
    updatedAt: toEpochMs(updatedAt),
    ...(assignedAt != null && { assignedAt: toEpochMs(assignedAt) }),
    ...(assignSlaDueAt != null && { assignSlaDueAt: toEpochMs(assignSlaDueAt) }),
    ...(resolveSlaDueAt != null && { resolveSlaDueAt: toEpochMs(resolveSlaDueAt) }),
    ...(assignSlaBreachedAt != null && { assignSlaBreachedAt: toEpochMs(assignSlaBreachedAt) }),
    ...(resolveSlaBreachedAt != null && { resolveSlaBreachedAt: toEpochMs(resolveSlaBreachedAt) }),
    ...(statusUpdatedAt != null && { statusUpdatedAt: toEpochMs(statusUpdatedAt) }),
  };
}

/** @deprecated Use {@link toAlertDetail}. */
export function toPublicAlert(r: AlertDdbRecord) {
  return toAlertDetail(r);
}
