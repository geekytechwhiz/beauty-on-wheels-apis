import type { EventSchemaMeta } from './define-event';

export function getSchemaMeta(schema: any): EventSchemaMeta {
  if (!schema.__meta) {
    throw new Error('Schema is missing metadata. Use defineEvent(...) to attach __meta.');
  }

  return schema.__meta;
}