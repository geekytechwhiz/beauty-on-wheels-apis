import { z } from 'zod';

export function defineEvent<T extends z.ZodTypeAny>(schema: T, meta: unknown): T & { __meta: unknown } {
  return Object.assign(schema, { __meta: meta });
}

export const publishEvent = jest.fn().mockResolvedValue(undefined);
export const configureEventDx = jest.fn();
export const configureEventPlatform = jest.fn();
export const onEvent = jest.fn(() => ({ handler: jest.fn() }));

export class EventBridgeAdapter {
  publish = jest.fn().mockResolvedValue(undefined);
}
