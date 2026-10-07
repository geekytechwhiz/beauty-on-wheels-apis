import { ChannelError, CHANNEL_ERROR_CODE } from '../errors/channel-error';
import { InMemoryConversationStore } from '../repositories/conversation.repository';
import { ListRow, MetaWhatsAppProvider, ReplyButton } from '../providers/meta-whatsapp.provider';
import {
  AvailabilityClient,
  BookingClient,
  CatalogClient,
  PricingClient,
  VehicleClient,
  VendorClient,
} from '../providers/domain.providers';
import { CustomerChannelService } from '../services/customer-channel.service';
import { CHANNEL, CONVERSATION_STATE } from '../types/domain';
import { IncomingMessage } from '../types/whatsapp';
import { ConversationFlow } from './conversation.flow';

class FakeMeta {
  texts: string[] = [];
  buttonMessages: Array<{ body: string; buttons: ReplyButton[] }> = [];
  lists: Array<{ body: string; rows: ListRow[] }> = [];
  async text(_to: string, text: string) { this.texts.push(text); }
  async buttons(_to: string, body: string, buttons: ReplyButton[]) { this.buttonMessages.push({ body, buttons }); }
  async list(_to: string, body: string, _button: string, rows: ListRow[]) { this.lists.push({ body, rows }); }
  async markRead() { return undefined; }
  async template() { return undefined; }
}

function message(id: string, text: string): IncomingMessage {
  return { messageId: id, from: '919800000000', type: text.startsWith('CAT:') || text.includes(':') || text.startsWith('MAIN_') || text === 'NO_COUPON' || text === 'CONFIRM_BOOKING' ? 'interactive' : 'text', interactiveId: text.includes(':') || text.startsWith('MAIN_') || text === 'NO_COUPON' || text === 'CONFIRM_BOOKING' ? text : undefined, text };
}

describe('ConversationFlow', () => {
  const catalog: CatalogClient = {
    listCategories: jest.fn().mockResolvedValue([{ id: 'cat1', name: 'Wash', active: true }]),
    listServices: jest.fn().mockResolvedValue([{ id: 'svc1', categoryId: 'cat1', name: 'Foam wash', active: true, durationMinutes: 30 }]),
    getService: jest.fn().mockResolvedValue({ id: 'svc1', categoryId: 'cat1', name: 'Foam wash', active: true }),
  };
  const availability: AvailabilityClient = {
    slots: jest.fn().mockResolvedValue([{ id: 'slot1', startTime: '10:00', endTime: '10:30', status: 'AVAILABLE', available: 1 }]),
    slot: jest.fn().mockResolvedValue({ id: 'slot1', startTime: '10:00', status: 'AVAILABLE', available: 1 }),
  };
  const pricing: PricingClient = {
    calculate: jest.fn().mockResolvedValue({ subtotal: 500, discount: 0, tax: 0, convenienceFee: 0, total: 500, currency: 'INR' }),
    validateCoupon: jest.fn().mockResolvedValue({ valid: true }),
  };
  const booking: BookingClient = {
    create: jest.fn().mockResolvedValue({ id: 'booking-1', bookingStatus: 'CREATED', paymentStatus: 'PENDING', totalAmount: 500 }),
    confirm: jest.fn().mockResolvedValue({ id: 'booking-1', bookingStatus: 'CONFIRMED', paymentStatus: 'PENDING', bookingDate: '2026-10-07', slotId: 'slot1', totalAmount: 500 }),
    cancel: jest.fn().mockResolvedValue({ id: 'booking-1', bookingStatus: 'CANCELLED' }),
    get: jest.fn(),
    listByCustomer: jest.fn().mockResolvedValue([]),
  };
  const vehicles: VehicleClient = {
    listForCustomer: jest.fn().mockResolvedValue({
      scoped: true,
      vehicles: [{ id: 'veh1', userId: 'customer-1', registrationNumber: 'KA01AB1234', vehicleType: 'SUV', brand: 'Tata', model: 'Nexon' }],
    }),
  };
  const vendors: VendorClient = {
    listActive: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({ vendorId: 'ven1', businessName: 'Glow', status: 'ACTIVE', operationalStatus: 'ONLINE' }),
  };

  function build() {
    const store = new InMemoryConversationStore();
    const meta = new FakeMeta();
    const users = { updateMarketingConsent: jest.fn().mockResolvedValue(undefined) };
    const customers = new CustomerChannelService(store, users, {});
    const flow = new ConversationFlow(
      store,
      meta as unknown as MetaWhatsAppProvider,
      catalog,
      availability,
      pricing,
      booking,
      vehicles,
      vendors,
      customers,
      { conversationTtlSeconds: 1800, businessName: 'Beauty on Wheels', pilotVendorIds: ['ven1'], timezone: 'Asia/Kolkata' },
    );
    return { store, meta, flow, users };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('walks welcome through booking confirmation without calculating the price locally', async () => {
    const { flow, meta, store } = build();
    const send = (id: string, text: string) => flow.handle(message(id, text), 'customer-1');

    await send('m1', 'hi');
    await send('m2', 'MAIN_BOOK');
    await send('m3', 'CAT:cat1');
    await send('m4', 'SVC:svc1');
    await send('m5', 'VEN:ven1');
    await send('m6', 'VEH:veh1');
    const date = meta.lists.at(-1)?.rows[0]?.id ?? '';
    await send('m7', date);
    await send('m8', 'SLOT:slot1');
    await send('m9', 'NO_COUPON');
    await send('m10', 'CONFIRM_BOOKING');

    expect(booking.create).toHaveBeenCalledTimes(1);
    expect(booking.create).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 500, customerId: 'customer-1', slotId: 'slot1' }));
    expect(booking.confirm).toHaveBeenCalledWith('booking-1');
    expect(meta.buttonMessages.at(-1)?.body).toContain('Payment is still pending');

    await send('m11', 'CONFIRM_BOOKING');
    expect(booking.create).toHaveBeenCalledTimes(1);
    const saved = await store.get('919800000000');
    expect(saved?.state).toBe(CONVERSATION_STATE.PAYMENT_PENDING);
    expect(saved?.activeBookingId).toBe('booking-1');
  });

  it('blocks a second confirmation while the first claim is in progress', async () => {
    const { flow, store } = build();
    const saved = await store.save({
      conversationId: 'c1',
      channel: CHANNEL.WHATSAPP,
      channelUserId: '919800000000',
      customerId: 'customer-1',
      state: CONVERSATION_STATE.BOOKING_REVIEW,
      context: {
        categoryId: 'cat1',
        serviceId: 'svc1',
        vendorId: 'ven1',
        vehicleId: 'veh1',
        date: '2026-10-07',
        slotId: 'slot1',
        price: { total: 500, currency: 'INR' },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 1800,
      version: 0,
    }, 0);
    expect(saved.version).toBe(1);

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    (booking.create as jest.Mock).mockImplementationOnce(async () => {
      await gate;
      return { id: 'booking-1', bookingStatus: 'CREATED', paymentStatus: 'PENDING', totalAmount: 500 };
    });

    const first = flow.handle(message('m1', 'CONFIRM_BOOKING'), 'customer-1');
    const second = flow.handle(message('m2', 'CONFIRM_BOOKING'), 'customer-1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await Promise.all([first, second]);
    expect(booking.create).toHaveBeenCalledTimes(1);
  });

  it('does not create a booking when pricing is unavailable', async () => {
    const { flow, meta } = build();
    (pricing.calculate as jest.Mock).mockRejectedValueOnce(new ChannelError(CHANNEL_ERROR_CODE.UNAVAILABLE, 'pricing missing', {
      metadata: { dependency: 'pricing', gap: 'MISSING_CONTRACT' },
    }));
    await flow.handle(message('m1', 'hi'), 'customer-1');
    await flow.handle(message('m2', 'MAIN_BOOK'), 'customer-1');
    await flow.handle(message('m3', 'CAT:cat1'), 'customer-1');
    await flow.handle(message('m4', 'SVC:svc1'), 'customer-1');
    await flow.handle(message('m5', 'VEN:ven1'), 'customer-1');
    await flow.handle(message('m6', 'VEH:veh1'), 'customer-1');
    const date = meta.lists.at(-1)?.rows[0]?.id ?? '';
    await flow.handle(message('m7', date), 'customer-1');
    await flow.handle(message('m8', 'SLOT:slot1'), 'customer-1');
    expect(meta.texts.some((text) => text.includes('Pricing is not available'))).toBe(true);
    expect(booking.create).not.toHaveBeenCalled();
  });

  it('reports a taken slot without a second create', async () => {
    const { flow, store, meta } = build();
    await store.save({
      conversationId: 'c1',
      channel: CHANNEL.WHATSAPP,
      channelUserId: '919800000000',
      customerId: 'customer-1',
      state: CONVERSATION_STATE.BOOKING_REVIEW,
      context: {
        categoryId: 'cat1',
        serviceId: 'svc1',
        vendorId: 'ven1',
        vehicleId: 'veh1',
        date: '2026-10-07',
        slotId: 'slot1',
        price: { total: 500, currency: 'INR' },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 1800,
      version: 0,
    }, 0);
    (booking.create as jest.Mock).mockRejectedValueOnce(new ChannelError(CHANNEL_ERROR_CODE.CONFLICT, 'slot taken'));
    await flow.handle(message('m1', 'CONFIRM_BOOKING'), 'customer-1');
    expect(booking.confirm).not.toHaveBeenCalled();
    expect(meta.texts.some((text) => text.includes('just taken'))).toBe(true);
  });

  it('starts a new session when the conversation expired', async () => {
    const { flow, store, meta } = build();
    await store.save({
      conversationId: 'old',
      channel: CHANNEL.WHATSAPP,
      channelUserId: '919800000000',
      state: CONVERSATION_STATE.SELECT_DATE,
      context: { serviceId: 'svc1' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: 1,
      version: 0,
    }, 0);
    await flow.handle(message('m1', 'hi'), 'customer-1');
    expect(meta.texts.some((text) => text.includes('expired'))).toBe(true);
    const saved = await store.get('919800000000');
    expect(saved?.state).toBe(CONVERSATION_STATE.MAIN_MENU);
    expect(saved?.context).toEqual({});
  });

  it('stores marketing opt-out from STOP', async () => {
    const { flow, store, users } = build();
    await flow.handle(message('m1', 'STOP'), 'customer-1');
    await expect(store.getMarketingConsent('919800000000')).resolves.toBe(false);
    expect(users.updateMarketingConsent).toHaveBeenCalledWith('customer-1', false);
  });

  it('does not show another customer vehicles', async () => {
    const { flow, meta } = build();
    (vehicles.listForCustomer as jest.Mock).mockResolvedValueOnce({ scoped: false, vehicles: [] });
    await flow.handle(message('m1', 'hi'), 'customer-1');
    await flow.handle(message('m2', 'MAIN_BOOK'), 'customer-1');
    await flow.handle(message('m3', 'CAT:cat1'), 'customer-1');
    await flow.handle(message('m4', 'SVC:svc1'), 'customer-1');
    await flow.handle(message('m5', 'VEN:ven1'), 'customer-1');
    expect(meta.texts.some((text) => text.includes('Vehicle Service'))).toBe(true);
    expect(booking.create).not.toHaveBeenCalled();
  });
});
