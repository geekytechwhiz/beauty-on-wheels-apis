import type { CreateMonitoringActionRequest } from './create-monitoring-action.request';

export type CreateMonitoringActionPayload = CreateMonitoringActionRequest;

/**
 * HTTP body for POST /tasks/monitoring-action.
 * `organizationId` is resolved from JWT — not sent by the client.
 *
 * `assignedToType` is `patient` | `careTeamRole` | `user` | `orgStaff` | `system`.
 * When not `patient`, require `assignedToStaffId` and `assignedToStaffDisplayName` (assignee id + display; GSI1).
 * Tasks are always patient-scoped (`patientId` required).
 */
export type CreateMonitoringActionHttpBody = Omit<CreateMonitoringActionRequest, 'organizationId'>;

/**
 * Maps validated HTTP body into the service payload.
 * `organizationId` from JWT; all other fields from the request body.
 */
export function createMonitoringActionPayloadFromHttpBody(
  organizationId: string,
  body: CreateMonitoringActionHttpBody,
): CreateMonitoringActionPayload {
  return {
    organizationId,
    ...body,
  };
}
