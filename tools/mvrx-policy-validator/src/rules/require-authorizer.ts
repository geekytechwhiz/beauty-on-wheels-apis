import { ValidationError } from '../utils/types';

const EXCLUDED_PATHS = ['/health'];

export function validateAuthorizer(
  config: Record<string, any>,
  file: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Opt-out for legacy services until a dedicated auth-hardening change (no API drift in infra PRs).
  if (config?.custom?.mvrxPolicy?.requireAuthorizer === false) {
    return errors;
  }

  const functions = config?.functions || {};

  Object.entries(functions).forEach(([functionName, fn]: [string, any]) => {
    const events = fn?.events || [];

    events.forEach((event: any) => {
      const http = event.http || event.httpApi;

      if (!http) {
        return;
      }

      const path = http.path;

      if (path && EXCLUDED_PATHS.includes(path)) {
        return;
      }

      const authorizer = http.authorizer;

      if (!authorizer) {
        errors.push({
          rule: 'require-authorizer',
          file,
          message: `Function '${functionName}' endpoint '${path}' is missing a custom authorizer.`,
        });
      }
    });
  });

  return errors;
}
