const SECRET_KEYS = new Set([
  'otp',
  'code',
  'codehash',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'token',
  'authorization',
  'password',
  'secret',
  'secretHash',
]);

const SECRET_SUBSTRINGS = [
  'otp',
  'token',
  'password',
  'secret',
  'authorization',
  'bearer',
];

function isSecretKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (SECRET_KEYS.has(normalized)) {
    return true;
  }
  return SECRET_SUBSTRINGS.some((part) => normalized.includes(part));
}

/**
 * Recursively strips credential/OTP fields so CLI logs and journals never
 * persist secrets. Used before every console write and journal error payload.
 */
export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return '[truncated]';
  }
  if (value == null) {
    return value;
  }
  if (typeof value === 'string') {
    // Never echo JWT-shaped or long opaque secrets.
    if (value.startsWith('eyJ') && value.includes('.')) {
      return '[redacted-jwt]';
    }
    if (/^\d{4,12}$/.test(value)) {
      return '[redacted-possible-otp]';
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(key)) {
        out[key] = '[redacted]';
      } else {
        out[key] = sanitizeForLog(nested, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function assertNoSecretsInText(label: string, text: string): void {
  const lower = text.toLowerCase();
  if (
    lower.includes('accesstoken') ||
    lower.includes('refreshToken'.toLowerCase()) ||
    lower.includes('"otp"') ||
    /bearer\s+[a-z0-9._-]+/i.test(text)
  ) {
    throw new Error(`${label} would expose credentials and was blocked`);
  }
}

export function fingerprintDestination(destination: string): string {
  // Stable non-reversible-enough operator fingerprint for journals (not a secret store).
  let hash = 0;
  for (let i = 0; i < destination.length; i += 1) {
    hash = (hash * 31 + destination.charCodeAt(i)) | 0;
  }
  return `dest:${(hash >>> 0).toString(16)}:len${destination.length}`;
}
