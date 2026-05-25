/**
 * @jest-environment node
 */
import type { BaseEvent } from '@api-hub/event-platform';

import { alertRecipientResolver } from './alert-recipient.resolver';

const baseEvent = (payload: Record<string, unknown>): BaseEvent<unknown> =>
  ({
    eventId: 'evt-1',
    eventType: 'CreateAlert.v1',
    eventVersion: '1.0.0',
    timestamp: '2026-01-01T00:00:00.000Z',
    source: 'test',
    idempotencyKey: 'idem-1',
    payload,
    meta: { correlationId: 'corr-1' },
  }) as BaseEvent<unknown>;

describe('alertRecipientResolver', () => {
  it('returns no recipients for ORG scope', async () => {
    const result = await alertRecipientResolver.resolve(
      baseEvent({
        organizationId: 'org-1',
        realtimeNotifyScope: 'ORG',
      }),
    );
    expect(result).toEqual([]);
  });

  it('returns notifyUserIds for RECIPIENTS scope', async () => {
    const result = await alertRecipientResolver.resolve(
      baseEvent({
        organizationId: 'org-1',
        realtimeNotifyScope: 'RECIPIENTS',
        notifyUserIds: [' nurse-1 ', 'nurse-2'],
      }),
    );
    expect(result).toEqual([
      { userId: 'nurse-1', organizationId: 'org-1' },
      { userId: 'nurse-2', organizationId: 'org-1' },
    ]);
  });

  it('returns notifyUserIds for BOTH scope', async () => {
    const result = await alertRecipientResolver.resolve(
      baseEvent({
        organizationId: 'org-1',
        realtimeNotifyScope: 'BOTH',
        notifyUserIds: ['nurse-1'],
      }),
    );
    expect(result).toHaveLength(1);
  });
});
