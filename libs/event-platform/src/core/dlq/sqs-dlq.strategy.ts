  import {
    DlqStrategy,
    DlqMessage,
  } from '../../typings/dlq.types';
  
  export class SqsDlqStrategy implements DlqStrategy {
    private client: SQSClient;
  
    constructor(
      private queueUrl: string,
      client?: SQSClient
    ) {
      this.client = client ?? new SQSClient({});
    }
  
    async send(message: DlqMessage): Promise<void> {
      try {
        const body = JSON.stringify(message);
  
        // 🔴 Optional: size guard (256 KB limit)
        if (Buffer.byteLength(body, 'utf8') > 256 * 1024) {
          console.warn('DLQ message too large, truncating...');
        }
  
        await this.client.send(
          new SendMessageCommand({
            QueueUrl: this.queueUrl,
            MessageBody: body,
  
            // ✅ Add attributes for filtering/debugging
            MessageAttributes: {
              eventType: {
                DataType: 'String',
                StringValue: message.metadata?.eventType ?? 'unknown',
              },
              correlationId: {
                DataType: 'String',
                StringValue:
                  message.metadata?.correlationId ?? 'unknown',
              },
              retryCount: {
                DataType: 'Number',
                StringValue: String(
                  message.metadata?.retryCount ?? 0
                ),
              },
            },
          })
        );
      } catch (err) {
        // 🚨 VERY IMPORTANT: never silently fail DLQ
        console.error('DLQ send failed', {
          error: err,
          fallbackMessage: message,
        });
  
        // optional: rethrow or swallow based on strategy
        // throw err;
      }
    }
  }