import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';

/**
 * Maps a persisted alert row to the public API shape: strips Dynamo/GSI attributes and renames
 * `organizationId` → `orgId`, SLA minute fields → `assignSla` / `resolveSla`.
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
    gsi5pk,
    gsi5sk,
    entityType,
    organizationId,
    assignSlaMinutes,
    resolveSlaMinutes,
    TableName,
    ...rest
  } = r;

  return {
    ...rest,
    orgId: organizationId,
    assignSla: assignSlaMinutes,
    resolveSla: resolveSlaMinutes,
  };
}

/** @deprecated Use {@link toAlertDetail}. */
export function toPublicAlert(r: AlertDdbRecord) {
  return toAlertDetail(r);
}
