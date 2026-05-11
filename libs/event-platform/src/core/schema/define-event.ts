import { z } from 'zod';
export type EventTransport =
  | 'eventbridge'
  | 'sns'
  | 'sqs';
export type EventSchemaMeta = {
  eventType: string;
  eventVersion: string;
  source: string;
  transport: EventTransport;
  correlationId?: string; 
};

export function defineEvent<T extends z.ZodTypeAny>(
  schema: T,
  meta: EventSchemaMeta
): T & { __meta: EventSchemaMeta } {
  return Object.assign(schema, { __meta: meta });
}