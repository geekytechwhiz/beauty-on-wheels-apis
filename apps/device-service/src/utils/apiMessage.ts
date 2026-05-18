import type { Message, Severity } from '@api-hub/utils';

/** Builds a typed API {@link Message} (title, description, severity). */
export function apiMessage(title: string, description?: string, severity: Severity = 'INFO'): Message {
  return { title, description: description ?? title, severity };
}
