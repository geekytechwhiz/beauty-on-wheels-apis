import { InMemoryConversationStore } from './conversation.repository';
import { consentPk, conversationPk, eventPk, identityPk } from '../infra/keys';
import { CHANNEL, CONVERSATION_STATE } from '../types/domain';

describe('conversation persistence', () => {
  it('uses channel key prefixes and optimistic versions', async () => {
    expect(conversationPk('9198')).toBe('CONV#9198');
    expect(identityPk('9198')).toBe('IDENT#WHATSAPP#9198');
    expect(consentPk('9198')).toBe('CONSENT#WHATSAPP#9198');
    expect(eventPk('wamid')).toBe('MSG#wamid');

    const store = new InMemoryConversationStore();
    const saved = await store.save({
      conversationId: 'c1',
      channel: CHANNEL.WHATSAPP,
      channelUserId: '9198',
      state: CONVERSATION_STATE.MAIN_MENU,
      context: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: 9999999999,
      version: 0,
    }, 0);
    expect(saved.version).toBe(1);
    await expect(store.save(saved, 0)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('claims an event once and allows a retry after release', async () => {
    const store = new InMemoryConversationStore();
    expect(await store.claimEvent('m1')).toBe(true);
    expect(await store.claimEvent('m1')).toBe(false);
    await store.completeEvent('m1');
    expect(await store.claimEvent('m1')).toBe(false);
  });

  it('does not claim a second booking while one is in progress', async () => {
    const store = new InMemoryConversationStore();
    const saved = await store.save({
      conversationId: 'c1',
      channel: CHANNEL.WHATSAPP,
      channelUserId: '9198',
      state: CONVERSATION_STATE.BOOKING_REVIEW,
      context: { slotId: 'slot-1' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: 9999999999,
      version: 0,
    }, 0);
    const first = await store.claimBooking('9198', saved.version);
    const second = await store.claimBooking('9198', first.record.version);
    expect(first.status).toBe('claimed');
    expect(second.status).toBe('inProgress');
    const attached = await store.attachBooking('9198', 'booking-1', first.record.version);
    expect(attached.activeBookingId).toBe('booking-1');
    const third = await store.claimBooking('9198', attached.version);
    expect(third.status).toBe('exists');
  });
});
