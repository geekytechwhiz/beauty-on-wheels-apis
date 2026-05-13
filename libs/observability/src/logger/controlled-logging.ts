import { getConfig } from '../config/config';
import { redactPiiValue } from '../core/pii';

export function enforcePolicy(payload: any) {
  if (!payload || typeof payload !== 'object') return payload;

  const cfg = getConfig();
  let cloned: Record<string, unknown> = { ...payload };

  if ('request' in cloned) cloned.request = '[BLOCKED]';
  if ('response' in cloned) cloned.response = '[BLOCKED]';

  if (cfg.redactPII) {
    cloned = redactPiiValue(cloned, cfg) as Record<string, unknown>;
  }

  return cloned;
}