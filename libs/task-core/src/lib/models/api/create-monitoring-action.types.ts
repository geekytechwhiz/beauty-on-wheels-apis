import type { CreateMonitoringActionRequest } from './create-monitoring-action.request';

export type CreateMonitoringActionPayload = CreateMonitoringActionRequest;

export type CreateMonitoringActionHttpBody = Omit<CreateMonitoringActionRequest, 'organizationId'>;

export function createMonitoringActionPayloadFromHttpBody(
  organizationId: string,
  body: CreateMonitoringActionHttpBody,
): CreateMonitoringActionPayload {
  return {
    organizationId,
    ...body,
  };
}
