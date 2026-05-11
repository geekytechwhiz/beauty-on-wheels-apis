export function enforcePolicy(payload: any) {
  if (!payload || typeof payload !== 'object') return payload;

  const cloned = { ...payload };

  if ('request' in cloned) cloned.request = '[BLOCKED]';
  if ('response' in cloned) cloned.response = '[BLOCKED]';

  return cloned;
}