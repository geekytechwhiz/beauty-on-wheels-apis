import type { EventBridgeEvent } from 'aws-lambda';
import { getTemplateRuntime } from '../../runtime';

type CarePlanCreatedEvent = {
  patientId: string;
  templateId: string;
  templateVersion: string;
  orgId: string;
};

export const main = async (
  event: EventBridgeEvent<'CarePlan.Created.v1', CarePlanCreatedEvent>,
): Promise<void> => {
  await getTemplateRuntime().bindRuntimeTemplateUseCase.execute({
    patientId: event.detail.patientId,
    templateId: event.detail.templateId,
    version: event.detail.templateVersion,
    orgId: event.detail.orgId,
  });
};
