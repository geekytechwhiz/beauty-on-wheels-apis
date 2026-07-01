import type { CreateMonitoringActionHttpBody } from './create-monitoring-action.types';
import type { CreateRuntimeTaskHttpBody } from './create-runtime-task.types';
import type { GenerateCarePlanTasksHttpBody } from './generate-care-plan.request';

/** HTTP + EventBridge input for monitoring action create. */
export type MonitoringActionIngressInput = CreateMonitoringActionHttpBody & {
  organizationId: string;
};

/** HTTP + EventBridge input for care-plan task generation. */
export type CarePlanTaskGenerationIngressInput = GenerateCarePlanTasksHttpBody & {
  organizationId: string;
};

/** HTTP input for runtime task create. */
export type RuntimeTaskHttpIngressInput = {
  kind: 'http';
  organizationId: string;
  body: CreateRuntimeTaskHttpBody;
  createdBy: string;
};

export type ServiceFlowRuntimeTaskIngressInput = {
  kind: 'serviceFlow';
  organizationId: string;
  patientId: string;
  taskPayload: Omit<CreateRuntimeTaskHttpBody, 'patientId' | 'runtimeTaskSource'>;
};

export type RuntimeTaskIngressInput =
  | RuntimeTaskHttpIngressInput
  | ServiceFlowRuntimeTaskIngressInput;
