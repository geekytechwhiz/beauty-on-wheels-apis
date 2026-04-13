import { sha256Hex, stableStringify } from '@api-hub/utils';

/** Deterministic key from a payload using stable serialization and SHA-256 (hex). */
export function generateIdempotencyKey(payload: unknown): string {
  return sha256Hex(stableStringify(payload));
}
