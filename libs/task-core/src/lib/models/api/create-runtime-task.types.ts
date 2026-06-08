import type { CreateRuntimeTaskRequest } from './create-runtime-task.request';

export type CreateRuntimeTaskHttpBody = Omit<
  CreateRuntimeTaskRequest,
  'organizationId' | 'createdBy'
>;

export type CreateRuntimeTaskPayload = CreateRuntimeTaskRequest;

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
