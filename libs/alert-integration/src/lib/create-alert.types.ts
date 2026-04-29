import type { AlertState, CreateAlertInput } from '@api-hub/alert-repository';

/** Use-case input for {@link AlertService.createAlert}; same shape as persistence (`inputType` / `sourceType` required). */
export type CreateAlertPayload = CreateAlertInput;

export type ListAlertsQueue = 'TEAM' | 'MY' | 'PATIENT';

/** Unified GET /alerts list input (validated HTTP query → service). */
export type ListAlertsParams = {
  organizationId: string;
  /** JWT actor; required when `queue` is `MY`. */
  actorUserId?: string;
  queue: ListAlertsQueue;
  patientId?: string;
  state?: AlertState;
  assignment?: 'UNASSIGNED' | 'ASSIGNED';
  priority?: string;
  inputType?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit: number;
};

/**
 * Maps a validated HTTP create body (org from JWT) into {@link CreateAlertPayload}:
 * hoists `appliesToType` / `linkedEntityCode` from `evidencePayload` to the top level per persistence.
 */
export function createAlertPayloadFromHttpBody(
  organizationId: string,
  actorUserId: string | undefined,
  body: Omit<CreateAlertPayload, 'organizationId' | 'actorUserId'>,
): CreateAlertPayload {
  const ev = body.evidencePayload;
  return {
    organizationId,
    actorUserId,
    ...body,
    appliesToType: typeof ev.appliesToType === 'string' ? ev.appliesToType : undefined,
    linkedEntityCode: typeof ev.linkedEntityCode === 'string' ? ev.linkedEntityCode : undefined,
    evidencePayload: { ...ev },
  };
}
