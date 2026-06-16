import type { CreateRuntimeTaskRequest } from './create-runtime-task.request';

/** Request body only — `organizationId` and `createdBy` are resolved server-side, not sent by the client. */
export type CreateRuntimeTaskHttpBody = Omit<
  CreateRuntimeTaskRequest,
  'organizationId' | 'createdBy'
>;

export type CreateRuntimeTaskPayload = CreateRuntimeTaskRequest;

/**
 * Maps validated HTTP body into the service payload.
 * `organizationId` from JWT; `patientId`, `patientDisplayName`, and task fields from input.
 * GSI1 on META when `assignedToStaffId` is set.
 */
export function createRuntimeTaskPayloadFromHttpBody(
  organizationId: string,
  body: CreateRuntimeTaskHttpBody,
  createdBy: string,
): CreateRuntimeTaskPayload {
  return {
    organizationId,
    createdBy,
    ...body,
  };
}
