import { randomUUID } from 'node:crypto';

const g = globalThis as typeof globalThis & { crypto?: { randomUUID: () => string } };
if (!g.crypto) {
  g.crypto = { randomUUID };
}
