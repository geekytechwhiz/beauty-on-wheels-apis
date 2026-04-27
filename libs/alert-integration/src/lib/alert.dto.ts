import type { AlertRecord } from '@api-hub/alert-repository';

/**
 * Maps a persisted `AlertRecord` to the public API shape (OpenAPI `AlertDetail` / `AlertSummary`): strips Dynamo/GSI
 * attributes and renames `organizationId` → `orgId`, `assignSlaMinutes` / `resolveSlaMinutes` → `assignSla` / `resolveSla`.
 * Used from HTTP controllers after `AlertService` returns a record (e.g. **201** / **409** create-alert).
 *
 * @see `apps/alert-service/docs/http-api-implementation-guide.md` §4.1
 */
export function toAlertDetail(r: AlertRecord) {
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
    ...rest
  } = r;

  return {
    ...rest,
    orgId: organizationId,
    assignSla: assignSlaMinutes,
    resolveSla: resolveSlaMinutes,
  };
}

/** @deprecated Use {@link toAlertDetail}; kept for callers that still import toPublicAlert. */
export function toPublicAlert(r: AlertRecord) {
  return toAlertDetail(r);
}
