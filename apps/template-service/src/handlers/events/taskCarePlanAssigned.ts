import type { EventBridgeEvent } from 'aws-lambda';
import { createChildLogger, createLogger } from '@api-hub/logger';

type CarePlanAssignedEvent = {
  carePlanId: string;
  patientId: string;
  templateId: string;
  version: string;
  orgId: string;
};

const baseLogger = createLogger({ service: 'task-careplan-consumer' });

export const main = async (
  event: EventBridgeEvent<'CarePlan.Assigned.v1', CarePlanAssignedEvent>,
): Promise<void> => {
  const logger = createChildLogger(baseLogger, {
    carePlanId: event.detail.carePlanId,
    patientId: event.detail.patientId,
    templateId: event.detail.templateId,
    version: event.detail.version,
  });

  logger.info({
    event: 'task_careplan_assigned_received',
    message: 'Example Task consumer received CarePlan.Assigned.v1',
  });
};
