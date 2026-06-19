import {
  CARE_PLAN_SYSTEM_ACTOR,
  RUNTIME_TASK_SOURCE,
  SERVICE_FLOW_SYSTEM_ACTOR,
  createRuntimeTaskPayloadFromHttpBody,
  generateCarePlanTasksPayloadFromHttpBody,
  type CreateRuntimeTaskHttpBody,
  type GenerateCarePlanTasksHttpBody,
} from '@api-hub/task-core';

import type { CarePlanTaskGenerationTriggeredPayload } from '../inbound/care-plan-task-generation-triggered.payload';
import type { ServiceFlowActivatedPayload } from '../inbound/service-flow-activated.payload';

export function mapIngestPayloadToCreateRuntimeTask(payload: ServiceFlowActivatedPayload) {
  const body = {
    patientId: payload.patientId,
    runtimeTaskSource: RUNTIME_TASK_SOURCE.SERVICE_FLOW_RUNTIME,
    ...payload.taskPayload,
  } as CreateRuntimeTaskHttpBody;

  return createRuntimeTaskPayloadFromHttpBody(
    payload.organizationId,
    body,
    SERVICE_FLOW_SYSTEM_ACTOR,
  );
}

export function mapIngestPayloadToGenerateCarePlanTasks(
  payload: CarePlanTaskGenerationTriggeredPayload,
) {
  const { organizationId, actorId, ...rest } = payload;
  const createdBy = actorId ? `${CARE_PLAN_SYSTEM_ACTOR}:${actorId}` : CARE_PLAN_SYSTEM_ACTOR;
  const body = rest as GenerateCarePlanTasksHttpBody;

  return generateCarePlanTasksPayloadFromHttpBody(organizationId, body, createdBy);
}
