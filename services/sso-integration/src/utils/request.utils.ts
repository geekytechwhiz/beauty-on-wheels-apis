import { SourceSystem, SSORequestContext } from '../types/common/context.types';
import { getEnvConfig } from '../config/env';

export function buildHeaders(
  context: SSORequestContext
): Record<string, string> {
 

  return {
    'X-Correlation-Id': context.correlationId,
    'X-source-system': SourceSystem.HMS,
    Authorization: `Bearer ${getEnvConfig().INTERNAL_SERVICE_TOKEN}`,
  };
}
 