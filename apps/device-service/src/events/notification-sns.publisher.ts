import { createSnsPublishEvent } from '@api-hub/event-platform';

const publishSns = createSnsPublishEvent({
  serviceName: 'device-service',
  topicArnEnv: 'NOTIFICATION_TOPIC_ARN',
  defaultSource: 'device-service',
});

export async function publishNotificationEvent<T>(
  eventType: string,
  data: T,
  correlationId?: string,
): Promise<void> {
  return publishSns({ eventType, payload: data }, correlationId);
}
