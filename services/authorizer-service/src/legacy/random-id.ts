/**
 * Legacy randomId for authorizer context (same shape as legacy generateRandomStringWithTimestamp).
 */

const LENGTH = 8;
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomString(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  return out;
}

export function generateRandomIdWithTimestamp(): string {
  return `${randomString(LENGTH)}${Date.now()}`;
}


