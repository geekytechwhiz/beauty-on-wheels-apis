import { z } from 'zod';

export type EventSchemaMeta = {
  eventType: string;
  eventVersion: string;
  source: string;

  correlationId?: string; 
};

export function defineEvent<T extends z.ZodTypeAny>(
  schema: T,
  meta: EventSchemaMeta
): T & { __meta: EventSchemaMeta } {
  return Object.assign(schema, { __meta: meta });
}