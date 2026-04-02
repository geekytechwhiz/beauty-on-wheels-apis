import type { EventBridgeEvent } from 'aws-lambda';
import { createChildLogger, createLogger } from '@api-hub/logger';
import type { TemplateEvent } from '@api-hub/template';

const baseLogger = createLogger({ service: 'careplan-template-consumer' });

export const main = async (event: EventBridgeEvent<'Template.Published.v1', TemplateEvent>): Promise<void> => {
  const logger = createChildLogger(baseLogger, {
    templateId: event.detail.templateId,
    orgId: event.detail.orgId,
    version: event.detail.version,
  });

  logger.info({
    event: 'careplan_template_published_received',
    message: 'Example CarePlan consumer received Template.Published.v1',
  });
};
