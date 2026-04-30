import type { ObservabilityConfig } from '../config/config.js';

const KEY_REDACT = new Set([
  'password',
  'email',
  'phone',
  'token',
  'authorization',
  'cookie',
  'set-cookie',
]);

const EMAIL_RE =
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE =
  /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}/g;
const JWT_LIKE_RE =
  /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

const toLowerKey = (value: string): string => value.toLowerCase();

function redactStringPattern(value: string): string {
  let out = value;
  out = out.replace(EMAIL_RE, '[REDACTED_EMAIL]');
  out = out.replace(BEARER_RE, 'Bearer [REDACTED]');
  out = out.replace(JWT_LIKE_RE, '[REDACTED_TOKEN]');
  out = out.replace(PHONE_RE, '[REDACTED_PHONE]');
  return out;
}

/** @internal Recursive PII redaction — config.redactPII must be checked by caller. */
export function redactPiiValue(data: unknown, _config: ObservabilityConfig): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => redactPiiValue(item, _config));
  }

  if (typeof data === 'string') {
    return redactStringPattern(data);
  }

  if (typeof data !== 'object' || data === null) {
    return data;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (KEY_REDACT.has(toLowerKey(key))) {
      output[key] = '[REDACTED]';
      continue;
    }
    if (typeof value === 'string') {
      output[key] = redactStringPattern(value);
    } else {
      output[key] = redactPiiValue(value, _config);
    }
  }

  return output;
}
