import { z } from 'zod';

import type { BaseEvent } from '../../typings/base-event.types';
import { EventSchemaError } from './event-schema-error';
import { validate, validatePayloadByEventType } from './validate';

describe('validate(event, schema)', () => {
  it('returns parsed data when valid', () => {
    const schema = z.object({ a: z.number() });
    expect(validate({ a: 1 }, schema)).toEqual({ a: 1 });
  });

  it('throws EventSchemaError when invalid', () => {
    const schema = z.object({ a: z.number() });
    expect(() => validate({ a: 'x' }, schema)).toThrow(EventSchemaError);
  });
});

describe('validatePayloadByEventType', () => {
  const base = (): BaseEvent => ({
    eventId: 'e',
    eventType: 'My.Event',
    eventVersion: '1',
    timestamp: '2026-01-01T00:00:00.000Z',
    source: 's',
    idempotencyKey: 'k',
    payload: { n: 1 },
    meta: {
      correlationId: 'c',
    },
  });

  it('passes when payload matches schema for eventType', () => {
    const event = base();
    const registry = { 'My.Event': z.object({ n: z.number() }) };
    expect(validatePayloadByEventType(event, registry).payload).toEqual({ n: 1 });
  });

  it('skips when no schema for eventType', () => {
    const event = base();
    expect(validatePayloadByEventType(event, { Other: z.string() })).toBe(event);
  });

  it('throws when payload invalid', () => {
    const event = { ...base(), payload: { n: 'bad' } };
    const registry = { 'My.Event': z.object({ n: z.number() }) };
    expect(() => validatePayloadByEventType(event, registry)).toThrow(EventSchemaError);
  });
});
