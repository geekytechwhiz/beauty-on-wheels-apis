import { ValidationError } from '../utils/types';

const HEALTH_PATHS = ['/health', '/healthz', '/status'];

export function validateHealthEndpoint(
  config: Record<string, any>,
  file: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  const functions = config?.functions || {};

  let healthEndpointFound = false;

  Object.values(functions).forEach((fn: any) => {
    const events = fn?.events || [];

    events.forEach((event: any) => {
      const http = event.http || event.httpApi;

      const path = http?.path;

      if (path && HEALTH_PATHS.includes(path)) {
        healthEndpointFound = true;
      }
    });
  });

  if (!healthEndpointFound) {
    errors.push({
      rule: 'require-health-endpoint',
      file,
      message:
        'Missing mandatory health endpoint (/health, /healthz or /status).',
    });
  }

  return errors;
}
