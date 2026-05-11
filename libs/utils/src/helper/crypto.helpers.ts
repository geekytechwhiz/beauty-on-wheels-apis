import { createHash } from 'crypto';

/** UTF-8 string or buffer input; returns lowercase hex SHA-256 digest. */
export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
