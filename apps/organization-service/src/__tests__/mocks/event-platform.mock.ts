import { jest } from '@jest/globals';
import { z } from 'zod';

export function defineEvent<T extends z.ZodTypeAny>(schema: T, meta: unknown): T & { __meta: unknown } {
  return Object.assign(schema, { __meta: meta });
}

export const publishEvent = jest
  .fn<(schema: unknown, payload: unknown, options?: unknown) => Promise<void>>()
  .mockResolvedValue(undefined);
export const configureEventPlatform = jest.fn();
export const onEvent = jest.fn(() => ({ handler: jest.fn() }));

export class EventBridgeAdapter {
  publish = jest.fn<(event: unknown) => Promise<void>>().mockResolvedValue(undefined);
}
