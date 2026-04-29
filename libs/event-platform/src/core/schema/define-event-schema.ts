import { z } from 'zod';

export type EventSchemaMeta = {
  eventType: string;
  eventVersion: string;
  source: string;

  correlationId?: string;
//   traceId?: string;
//   spanId?: string;
//   retryCount?: number;
//   publishedAt?: string;
//   tenantId?: string;
//   userId?: string;
//   channel?: 'web' | 'mobile' | 'system' | 'cron' | string;
//   environment?: 'dev' | 'qa' | 'staging' | 'prod';
//   schemaRef?: string;
//   causationId?: string;
//   attributes?: Record<string, unknown>;
  
};

export function defineEventSchema<T extends z.ZodTypeAny>(
  schema: T,
  meta: EventSchemaMeta
): T & { __meta: EventSchemaMeta } {
  return Object.assign(schema, { __meta: meta });
}