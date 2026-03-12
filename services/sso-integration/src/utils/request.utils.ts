import { SSORequestContext } from '../types/common/context.types';
import { SERVICE_TOKEN_HEADER } from './constants';

export function buildServiceHeaders(
  context: SSORequestContext
): Record<string, string> {
 

  return {
    'X-Correlation-Id': context.correlationId,
    Authorization: `Bearer ${SERVICE_TOKEN_HEADER}`,
  };
}