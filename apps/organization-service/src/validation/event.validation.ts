import { z } from 'zod';

export const eventBridgeEventSchema = z.object({
  version: z.string(),
  id: z.string(),
  'detail-type': z.string(),
  source: z.string(),
  account: z.string(),
  time: z.string(),
  region: z.string(),
  resources: z.array(z.string()).optional(),
  detail: z.record(z.string(), z.unknown()),
});

export const dynamoDBStreamEventSchema = z.object({
  Records: z.array(
    z.object({
      eventID: z.string(),
      eventName: z.enum(['INSERT', 'MODIFY', 'REMOVE']),
      eventSource: z.string(),
      eventSourceARN: z.string(),
      awsRegion: z.string(),
      dynamodb: z.object({
        ApproximateCreationDateTime: z.number().optional(),
        Keys: z.record(z.string(), z.unknown()),
        NewImage: z.record(z.string(), z.unknown()).optional(),
        OldImage: z.record(z.string(), z.unknown()).optional(),
        SequenceNumber: z.string(),
        SizeBytes: z.number(),
        StreamViewType: z.string(),
      }),
    }),
  ),
});
