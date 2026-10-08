import type { SQSEvent, SQSRecord } from 'aws-lambda';

export function eventBridgeOnSqs(input: {
  source: string;
  detailType: string;
  detail: unknown;
  messageId?: string;
}): SQSEvent {
  const record: SQSRecord = {
    messageId: input.messageId ?? 'mid-1',
    receiptHandle: 'rh-1',
    body: JSON.stringify({
      source: input.source,
      'detail-type': input.detailType,
      detail: input.detail,
    }),
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '1',
      SenderId: 'sender',
      ApproximateFirstReceiveTimestamp: '1',
    },
    messageAttributes: {},
    md5OfBody: 'x',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:email-notification',
    awsRegion: 'us-east-1',
  };
  return { Records: [record] };
}
