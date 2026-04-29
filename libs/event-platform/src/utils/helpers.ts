 
import { PayloadSchemaRegistry } from "../typings/consumer.types"; 
import { BaseEvent } from "../typings/base-event.types";
import { z } from "zod";
 
  export const resolveSchema = ( schemas: PayloadSchemaRegistry | undefined,
    eventType: string,
    version: string,): string => {
        const eventSchemas:any = schemas?.[eventType];

        if (!eventSchemas) {
          throw new Error(`No schemas found for eventType: ${eventType}`);
        }
      
        const schema:any = eventSchemas[version];
      
        if (!schema) {
          throw new Error(
            `No schema for eventType=${eventType}, version=${version}`,
          );
        }
      
        return schema;
  }

  export function buildInternalMapper(
    schemaMap: Record<string, Record<string, z.ZodType<unknown>>>,
    source: string,
  ) {
    return (raw: any): BaseEvent<unknown> => {
      const eventType = raw['detail-type'];
      const detail = raw.detail || {};
  
      const version = detail.version || 'v1';
  
      const schema = schemaMap[eventType]?.[version];
  
      if (!schema) {
        throw new Error(
          `Schema not found for ${eventType} version ${version}`,
        );
      }
  
      const payload = schema.parse(detail);
  
      const correlationId =
        detail.meta?.correlationId ||
        detail.correlationId ||
        raw.correlationId ||
        raw.id;
  
      return {
        eventId: raw.id,
        eventType,
        eventVersion: version, // ✅ FIXED
        timestamp: raw.time,
        source,
  
        idempotencyKey:
          detail.idempotencyKey || raw.id,
  
        payload,
  
        meta: {
          correlationId,                     // ✅ REQUIRED
          retryCount: detail.meta?.retryCount ?? 0,
          publishedAt: raw.time,
        },
      };
    };
  }

  export function generateEventId(): string {
    return crypto.randomUUID(); // or uuid v7 if you prefer ordering
  }
  
  export function nowIso(): string {
    return new Date().toISOString();
  }
   