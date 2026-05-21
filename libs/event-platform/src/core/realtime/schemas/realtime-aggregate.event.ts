import { z } from 'zod';

import { defineEvent } from '../../schema/define-event';

const RealtimeRecipientSchema = z.object({
  userId: z.string(),
  organizationId: z.string().optional(),
});

const RealtimeMessageSchema = z.object({
  channel: z.string(),
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  recipientIds: z.array(z.string()),
});

export const RealtimeAggregatePayloadSchema = z.object({
  recipients: z.array(RealtimeRecipientSchema),
  message: RealtimeMessageSchema,
  metadata: z.object({
    correlationId: z.string(),
    eventId: z.string(),
    eventType: z.string(),
    timestamp: z.string(),
  }),
});

export const RealtimeAggregateEventSchema = defineEvent(RealtimeAggregatePayloadSchema, {
  eventType: 'realtime.aggregate',
  eventVersion: '1.0.0',
  source: 'event-platform',
  transport: 'sqs',
});

export const REALTIME_AGGREGATE_EVENT_TYPE = 'realtime.aggregate' as const;
