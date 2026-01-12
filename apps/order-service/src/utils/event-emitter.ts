import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { createLogger } from "@api-hub/logger";

type EventPayload = Record<string, any>;

export class EventEmitter {
  private sns?: SNSClient;
  private topicArn?: string;
  private disabled: boolean;
  private log = createLogger({ service: "event-emitter" });

  constructor() {
    const eventsStreamArn = process.env.EVENTS_STREAM_ARN;
    // NOTE: SQS notifications removed; keep SNS only
    const region =
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
    const isOffline =
      process.env.IS_OFFLINE === "true" || process.env.OFFLINE === "true";
    const skip =
      (process.env.SKIP_EXTERNAL_INTEGRATIONS || "").toLowerCase() === "true";

    // Treat placeholder resources as disabled
    const isPlaceholderTopic =
      !!eventsStreamArn && eventsStreamArn.includes(":000000000000:");

    this.disabled = isOffline || skip;
    if (this.disabled) {
      this.log.debug({ event: 'Event integrations disabled', isOffline, skip });
    }

    if (!this.disabled && eventsStreamArn && !isPlaceholderTopic) {
      this.sns = new SNSClient({ region });
      this.topicArn = eventsStreamArn;
      this.log.debug({ event: 'SNS configured', topicArn: this.topicArn });
    }
  }

  async publishEvent(event: EventPayload) {
    if (this.disabled) return;
    if (this.sns && this.topicArn) {
      try {
        await this.sns.send(
          new PublishCommand({
            TopicArn: this.topicArn,
            Message: JSON.stringify(event),
          })
        );
        this.log.debug({ event: 'Event published to SNS', type: event?.type });
      } catch (e: any) {
        this.log.error({ event: 'Failed to publish event to SNS', err: e, message: e?.message });
      }
    }
  }
  // Notifications via SQS removed. If a no-op enqueue is needed elsewhere,
  // call `publishEvent` or implement a custom stub in tests.
}
