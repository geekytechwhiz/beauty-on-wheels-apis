import { SSORequestContext } from '../types/common/context.types';
import { getEnvConfig } from '../config/env';

export function buildServiceHeaders(
  context: SSORequestContext
): Record<string, string> {
 

  return {
    'X-Correlation-Id': context.correlationId,
    Authorization: `Bearer ${getEnvConfig().INTERNAL_SERVICE_TOKEN}`,
  };
}