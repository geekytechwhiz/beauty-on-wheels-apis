import { z } from 'zod';

export type ResolveSchemaOptions = {
  /** Default `throw` preserves strict registry validation. */
  onMissingSchema?: 'throw' | 'noop';
};

export function resolveSchema(
  schemas: Record<string, Record<string, z.ZodTypeAny>> | undefined,
  eventType: string,
  version: string,
  options?: ResolveSchemaOptions,
): z.ZodTypeAny {
  const onMissing = options?.onMissingSchema ?? 'throw';
  const eventSchemas = schemas?.[eventType];

  if (!eventSchemas) {
    if (onMissing === 'noop') {
      return z.any();
    }
    throw new Error(`No schemas found for ${eventType}`);
  }

  const schema = eventSchemas[version];

  if (!schema) {
    if (onMissing === 'noop') {
      return z.any();
    }
    throw new Error(`No schema for ${eventType} version ${version}`);
  }

  return schema;
}
