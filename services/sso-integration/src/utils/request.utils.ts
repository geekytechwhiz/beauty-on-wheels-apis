import { SSORequestContext } from '../types/common/context.types';
import { getEnvConfig } from '../config/env';

export function buildServiceHeaders(
  context: SSORequestContext
): Record<string, string> {

  const config = getEnvConfig();

  return {
    'X-Correlation-Id': context.correlationId,
    Authorization: `Bearer ${config.INTERNAL_SERVICE_TOKEN}`,
  };
}