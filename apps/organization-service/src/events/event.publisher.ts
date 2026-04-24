import { createSnsPublishEvent } from '@api-hub/event-platform';

export const publishEvent = createSnsPublishEvent({
  serviceName: 'organization-service',
  topicArnEnv: 'ORGANIZATION_EVENTS_TOPIC_ARN',
  defaultSource: 'organization-service',
});
