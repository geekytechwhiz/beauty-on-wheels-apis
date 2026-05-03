import { ALERT_STATE, type AlertState } from '../types/alert-state.type';
import type { AlertDdbRecord } from '../persistence/alert-ddb.model';
import type { CreateAlertRequest } from './create-alert.request';

export type CreateAlertPayload = CreateAlertRequest;
/** @deprecated Prefer {@link CreateAlertRequest}. */
export type CreateAlertInput = CreateAlertRequest;

export type ListAlertsQueue = 'TEAM' | 'MY' | 'PATIENT';

/** Unified GET /alerts list input (validated HTTP query → service). */
export type ListAlertsParams = {
  organizationId: string;
  /** JWT actor; required when `queue` is `MY`. */
  actorUserId?: string;
  queue: ListAlertsQueue;
  patientId?: string;
  state?: AlertState;
  assignment?: typeof ALERT_STATE.UNASSIGNED | typeof ALERT_STATE.ASSIGNED;
  priority?: string;
  inputType?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit: number;
  /** DynamoDB query continuation; opaque string from the prior response `nextToken`. */
  nextToken?: string;
};

/** Result of {@link AlertService.listAlerts}. */
export type ListAlertsResult = {
  items: AlertDdbRecord[];
  nextToken?: string;
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
