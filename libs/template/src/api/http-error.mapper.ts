import { TemplateError } from '../shared';

export function ensureHttpError(error: unknown): Error {
  if (error instanceof TemplateError) {
    return error;
  }
  return error instanceof Error ? error : new Error(String(error));
}
