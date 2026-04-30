import type { EventSchemaMeta } from './define-event';

export function getSchemaMeta(schema: any): EventSchemaMeta {
  if (!schema.__meta) {
    throw new Error(
      'Schema is missing metadata. Use defineEventHandler()'
    );
  }

  return schema.__meta;
}