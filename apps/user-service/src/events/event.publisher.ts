import { createSnsPublishEvent } from '@api-hub/event-platform';

/**
 * SNS notification domain events — envelope, validation hook, and publish logging are centralized in
 * {@link createSnsPublishEvent}.
 */
export const publishEvent = createSnsPublishEvent({
  serviceName: 'user-service',
  topicArnEnv: 'USER_EVENTS_TOPIC_ARN',
  defaultSource: 'user-service',
});
