import { randomUUID } from 'node:crypto';
import { createChildLogger, createLogger } from '@api-hub/observability';
import { ChannelError, CHANNEL_ERROR_CODE, customerMessage, maskPhone } from '../errors/channel-error';
import { ConversationStore } from '../repositories/conversation.repository';
import { recordMetric, WHATSAPP_METRIC } from '../infra/metrics';
import { ListRow, MetaWhatsAppProvider } from '../providers/meta-whatsapp.provider';
import {
  AvailabilityClient,
  BookingClient,
  CatalogClient,
  PricingClient,
  VehicleClient,
  VendorClient,
} from '../providers/domain.providers';
import { CustomerChannelService } from '../services/customer-channel.service';
import { Templates } from '../templates/messages';
import {
  Booking,
  CatalogService,
  CHANNEL,
  CONVERSATION_STATE,
  ConversationRecord,
  Slot,
  VendorSummary,
} from '../types/domain';
import { IncomingMessage } from '../types/whatsapp';
import { MENU_COMMANDS, OPT_IN_COMMANDS, OPT_OUT_COMMANDS, STATE_MACHINE } from './state-machine';

const logger = createChildLogger(createLogger({ service: 'whatsapp-channel-service', redactPII: true }), {
  component: 'conversation-flow',
});

export interface FlowConfig {
  conversationTtlSeconds: number;
  businessName: string;
  pilotVendorIds: string[];
  timezone: string;
}

const MENU_BUTTONS = [
  { id: 'MAIN_BOOK', title: 'Book Service' },
  { id: 'MAIN_BOOKINGS', title: 'My Bookings' },
  { id: 'MAIN_HELP', title: 'Help' },
];

export class ConversationFlow {
  constructor(
    private readonly store: ConversationStore,
    private readonly meta: MetaWhatsAppProvider,
    private readonly catalog: CatalogClient,
    private readonly availability: AvailabilityClient,
    private readonly pricing: PricingClient,
    private readonly booking: BookingClient,
    private readonly vehicles: VehicleClient,
    private readonly vendors: VendorClient,
    private readonly customers: CustomerChannelService,
    private readonly config: FlowConfig,
  ) {}

  async handle(message: IncomingMessage, customerId?: string): Promise<void> {
    const channelUserId = message.from;
    const nowSec = Math.floor(Date.now() / 1000);
    let conversation = await this.store.get(channelUserId);
    let started = false;

    if (!conversation) {
      conversation = this.newConversation(channelUserId, customerId);
      started = true;
    } else if (conversation.expiresAt <= nowSec) {
      conversation = {
        ...this.newConversation(channelUserId, customerId ?? conversation.customerId),
        version: conversation.version,
      };
      conversation.state = CONVERSATION_STATE.EXPIRED;
      await this.meta.text(channelUserId, Templates.expired());
      started = true;
    }

    if (customerId && conversation.customerId !== customerId) conversation.customerId = customerId;
    if (started) recordMetric(WHATSAPP_METRIC.CONVERSATION_STARTED);

    try {
      const outcome = await this.route(conversation, message);
      if (outcome?.skipSave) return;
      conversation.lastMessageId = message.messageId;
      conversation.updatedAt = new Date().toISOString();
      conversation.expiresAt = nowSec + this.config.conversationTtlSeconds;
      const saved = await this.store.save(conversation, conversation.version);
      conversation.version = saved.version;
    } catch (error) {
      logger.error({
        event: 'conversation_failed',
        err: error,
        conversationId: conversation.conversationId,
        state: conversation.state,
        phoneMasked: maskPhone(channelUserId),
      });
      recordMetric(WHATSAPP_METRIC.MESSAGES_FAILED);
      if (error instanceof ChannelError && error.code === CHANNEL_ERROR_CODE.CONFLICT) {
        const latest = await this.store.get(channelUserId);
        if (latest?.activeBookingId || latest?.bookingClaim) {
          await this.meta.text(channelUserId, Templates.confirmationInProgress());
          return;
        }
      }
      conversation.state = CONVERSATION_STATE.ERROR;
      conversation.updatedAt = new Date().toISOString();
      conversation.expiresAt = nowSec + this.config.conversationTtlSeconds;
      await this.meta.text(channelUserId, customerMessage(error));
      await this.meta.buttons(channelUserId, 'Reply MENU to start again.', [{ id: 'MENU', title: 'Main menu' }]);
      try {
        await this.store.save(conversation, conversation.version);
      } catch (saveError) {
        if (!(saveError instanceof ChannelError) || saveError.code !== CHANNEL_ERROR_CODE.CONFLICT) throw saveError;
      }
    }
  }

  private newConversation(channelUserId: string, customerId?: string): ConversationRecord {
    const now = new Date().toISOString();
    return {
      conversationId: randomUUID(),
      channel: CHANNEL.WHATSAPP,
      channelUserId,
      customerId,
      state: CONVERSATION_STATE.WELCOME,
      context: {},
      createdAt: now,
      updatedAt: now,
      expiresAt: Math.floor(Date.now() / 1000) + this.config.conversationTtlSeconds,
      version: 0,
    };
  }

  private async route(conversation: ConversationRecord, message: IncomingMessage): Promise<{ skipSave?: boolean } | void> {
    if (message.type === 'unknown' || message.type === 'image') {
      await this.meta.text(conversation.channelUserId, 'Please use the menu options or reply MENU.');
      return this.render(conversation);
    }

    const raw = (message.interactiveId ?? message.text ?? '').trim();
    const action = raw.toLowerCase();

    if (OPT_OUT_COMMANDS.has(action)) {
      await this.customers.setMarketingConsent(conversation.channelUserId, conversation.customerId, false);
      await this.meta.text(conversation.channelUserId, Templates.unsubscribed());
      return;
    }
    if (OPT_IN_COMMANDS.has(action)) {
      await this.customers.setMarketingConsent(conversation.channelUserId, conversation.customerId, true);
      await this.meta.text(conversation.channelUserId, Templates.subscribed());
      return this.mainMenu(conversation);
    }
    if (MENU_COMMANDS.has(action) || raw === 'MENU') return this.mainMenu(conversation);
    if (raw === 'BACK' || action === 'back') return this.goBack(conversation);
    if (raw === 'MAIN_BOOK' || action === 'book service' || action === 'browse services') return this.showCategories(conversation);
    if (raw === 'MAIN_BOOKINGS' || action === 'my bookings') return this.showBookings(conversation);
    if (raw === 'MAIN_OFFERS' || action === 'offers') return this.showOffers(conversation);
    if (raw === 'MAIN_HELP' || action === 'help') return this.showHelp(conversation);

    const prefixed = this.prefixed(raw);
    if (prefixed?.name === 'CANCEL') return this.askCancel(conversation, prefixed.value);
    if (prefixed?.name === 'BOOK') return this.showBookingDetails(conversation, prefixed.value);

    switch (conversation.state) {
      case CONVERSATION_STATE.BROWSE_CATEGORY:
        return this.selectCategory(conversation, prefixed?.name === 'CAT' ? prefixed.value : raw);
      case CONVERSATION_STATE.SELECT_SERVICE:
        return this.selectService(conversation, prefixed?.name === 'SVC' ? prefixed.value : raw);
      case CONVERSATION_STATE.SELECT_PROVIDER:
        return this.selectProvider(conversation, prefixed?.name === 'VEN' ? prefixed.value : raw);
      case CONVERSATION_STATE.SELECT_VEHICLE:
        return this.selectVehicle(conversation, prefixed?.name === 'VEH' ? prefixed.value : raw);
      case CONVERSATION_STATE.SELECT_DATE:
        return this.selectDate(conversation, prefixed?.name === 'DATE' ? prefixed.value : raw);
      case CONVERSATION_STATE.SELECT_SLOT:
        return this.selectSlot(conversation, prefixed?.name === 'SLOT' ? prefixed.value : raw);
      case CONVERSATION_STATE.PRICE_REVIEW:
        return this.handlePriceReview(conversation, raw);
      case CONVERSATION_STATE.COUPON:
        return this.handleCoupon(conversation, raw, action);
      case CONVERSATION_STATE.BOOKING_REVIEW:
        return raw === 'CONFIRM_BOOKING' ? this.confirmBooking(conversation) : this.showReview(conversation);
      case CONVERSATION_STATE.CANCEL_BOOKING:
        return raw === 'CONFIRM_CANCEL' ? this.cancelBooking(conversation) : this.render(conversation);
      case CONVERSATION_STATE.BOOKING_CONFIRMATION:
        return this.advanceConfirmation(conversation);
      case CONVERSATION_STATE.PAYMENT_PENDING:
      case CONVERSATION_STATE.BOOKED:
      case CONVERSATION_STATE.HELP:
      case CONVERSATION_STATE.ERROR:
      case CONVERSATION_STATE.WELCOME:
      case CONVERSATION_STATE.EXPIRED:
      case CONVERSATION_STATE.MAIN_MENU:
      case CONVERSATION_STATE.MY_BOOKINGS:
      case CONVERSATION_STATE.BOOKING_DETAILS:
        return this.render(conversation);
      default:
        return this.mainMenu(conversation);
    }
  }

  private prefixed(raw: string): { name: string; value: string } | undefined {
    const match = /^([A-Za-z]+):(.+)$/.exec(raw.trim());
    if (!match) return undefined;
    return { name: match[1].toUpperCase(), value: match[2] };
  }

  private async goBack(conversation: ConversationRecord): Promise<void> {
    const target = STATE_MACHINE[conversation.state].back ?? CONVERSATION_STATE.MAIN_MENU;
    if (target === CONVERSATION_STATE.MAIN_MENU) return this.mainMenu(conversation);
    conversation.state = target;
    return this.render(conversation);
  }

  private async render(conversation: ConversationRecord): Promise<void> {
    switch (conversation.state) {
      case CONVERSATION_STATE.BROWSE_CATEGORY:
        return this.showCategories(conversation);
      case CONVERSATION_STATE.SELECT_SERVICE:
        return conversation.context.categoryId ? this.showServices(conversation, conversation.context.categoryId) : this.showCategories(conversation);
      case CONVERSATION_STATE.SELECT_PROVIDER:
        return this.showProviders(conversation);
      case CONVERSATION_STATE.SELECT_VEHICLE:
        return this.showVehicles(conversation);
      case CONVERSATION_STATE.SELECT_DATE:
        return this.showDates(conversation);
      case CONVERSATION_STATE.SELECT_SLOT:
        return conversation.context.date ? this.showSlots(conversation, conversation.context.date) : this.showDates(conversation);
      case CONVERSATION_STATE.PRICE_REVIEW:
      case CONVERSATION_STATE.BOOKING_REVIEW:
        return this.showReview(conversation);
      case CONVERSATION_STATE.COUPON:
        conversation.state = CONVERSATION_STATE.COUPON;
        await this.meta.text(conversation.channelUserId, 'Please type your coupon code, or choose No Coupon.');
        return;
      case CONVERSATION_STATE.MY_BOOKINGS:
        return this.showBookings(conversation);
      case CONVERSATION_STATE.BOOKING_DETAILS:
        return conversation.context.bookingId ? this.showBookingDetails(conversation, conversation.context.bookingId) : this.showBookings(conversation);
      case CONVERSATION_STATE.CANCEL_BOOKING:
        return this.askCancel(conversation, conversation.context.bookingId ?? '');
      case CONVERSATION_STATE.PAYMENT_PENDING:
        await this.meta.text(conversation.channelUserId, 'Payment is still pending for this booking. Reply MENU to return to the main menu.');
        return;
      case CONVERSATION_STATE.HELP:
        return this.showHelp(conversation);
      case CONVERSATION_STATE.BOOKING_CONFIRMATION:
        return this.advanceConfirmation(conversation);
      default:
        return this.mainMenu(conversation);
    }
  }

  private async mainMenu(conversation: ConversationRecord): Promise<void> {
    conversation.state = CONVERSATION_STATE.MAIN_MENU;
    conversation.context = {};
    await this.meta.buttons(conversation.channelUserId, Templates.welcome(this.config.businessName), MENU_BUTTONS);
  }

  private async showHelp(conversation: ConversationRecord): Promise<void> {
    conversation.state = CONVERSATION_STATE.HELP;
    await this.meta.buttons(conversation.channelUserId, Templates.help(), [{ id: 'MENU', title: 'Main menu' }]);
  }

  private async showOffers(conversation: ConversationRecord): Promise<void> {
    const optedIn = await this.customers.hasMarketingConsent(conversation.channelUserId);
    if (!optedIn) {
      await this.meta.text(conversation.channelUserId, 'Reply OPT IN to receive marketing messages. Offers are not sent without consent.');
      return;
    }
    await this.meta.text(conversation.channelUserId, 'Offers are managed by marketing. No campaign is available in this chat yet.');
  }

  private async showCategories(conversation: ConversationRecord): Promise<void> {
    const categories = (await this.catalog.listCategories()).filter((category) => category.active !== false && category.id);
    conversation.state = CONVERSATION_STATE.BROWSE_CATEGORY;
    if (!categories.length) {
      await this.meta.text(conversation.channelUserId, 'No service categories are available right now.');
      return this.mainMenu(conversation);
    }
    await this.meta.list(
      conversation.channelUserId,
      this.pageNote('Choose a service category:', categories.length),
      'Categories',
      categories.slice(0, 10).map((category) => ({
        id: `CAT:${category.id}`,
        title: category.name,
        description: category.description,
      })),
    );
  }

  private async selectCategory(conversation: ConversationRecord, categoryId: string): Promise<void> {
    if (!categoryId || categoryId.includes(':')) return this.showCategories(conversation);
    return this.showServices(conversation, categoryId);
  }

  private async showServices(conversation: ConversationRecord, categoryId: string): Promise<void> {
    const services = (await this.catalog.listServices(categoryId)).filter((service) => service.active !== false && service.id);
    if (!services.length) {
      await this.meta.text(conversation.channelUserId, 'No services are available in this category right now.');
      return this.showCategories(conversation);
    }
    conversation.context.categoryId = categoryId;
    conversation.state = CONVERSATION_STATE.SELECT_SERVICE;
    await this.meta.list(
      conversation.channelUserId,
      this.pageNote('Choose a service:', services.length),
      'Services',
      services.slice(0, 10).map((service) => ({
        id: `SVC:${service.id}`,
        title: service.name,
        description: service.durationMinutes ? `${service.durationMinutes} min` : undefined,
      })),
    );
  }

  private async selectService(conversation: ConversationRecord, serviceId: string): Promise<void> {
    if (!conversation.context.categoryId || !serviceId) return this.showCategories(conversation);
    const service = await this.catalog.getService(conversation.context.categoryId, serviceId);
    if (!service.id || service.active === false) {
      await this.meta.text(conversation.channelUserId, 'That service is not available. Please choose another.');
      return this.showServices(conversation, conversation.context.categoryId);
    }
    conversation.context.serviceId = service.id;
    return this.showProviders(conversation, service);
  }

  private async showProviders(conversation: ConversationRecord, service?: CatalogService): Promise<void> {
    const available = await this.loadProviders();
    conversation.state = CONVERSATION_STATE.SELECT_PROVIDER;
    if (!available.length) {
      await this.meta.text(conversation.channelUserId, Templates.noProviders());
      return this.mainMenu(conversation);
    }
    const intro = service ? `Selected: ${service.name}\n\nChoose a provider:` : 'Choose a provider:';
    await this.meta.list(
      conversation.channelUserId,
      this.pageNote(intro, available.length),
      'Providers',
      available.slice(0, 10).map((vendor) => ({
        id: `VEN:${vendor.vendorId}`,
        title: vendor.businessName ?? vendor.vendorId,
      })),
    );
  }

  private async loadProviders(): Promise<VendorSummary[]> {
    if (this.config.pilotVendorIds.length > 0) {
      const vendors = await Promise.all(this.config.pilotVendorIds.map(async (vendorId) => {
        try {
          return await this.vendors.get(vendorId);
        } catch (error) {
          logger.warn({ event: 'pilot_vendor_skipped', vendorId, code: error instanceof ChannelError ? error.code : 'INTERNAL_ERROR' });
          return undefined;
        }
      }));
      return vendors.filter((vendor): vendor is VendorSummary => !!vendor && this.providerAvailable(vendor));
    }
    const listed = await this.vendors.listActive(10);
    return listed.filter((vendor) => this.providerAvailable(vendor));
  }

  private providerAvailable(vendor: VendorSummary): boolean {
    if (vendor.status && vendor.status !== 'ACTIVE') return false;
    if (vendor.operationalStatus === 'OFFLINE' || vendor.operationalStatus === 'TEMPORARILY_UNAVAILABLE') return false;
    return true;
  }

  private async selectProvider(conversation: ConversationRecord, vendorId: string): Promise<void> {
    const vendor = await this.vendors.get(vendorId);
    if (!this.providerAvailable(vendor)) {
      await this.meta.text(conversation.channelUserId, 'That provider is unavailable. Please choose another.');
      return this.showProviders(conversation);
    }
    conversation.context.vendorId = vendor.vendorId;
    return this.showVehicles(conversation);
  }

  private async showVehicles(conversation: ConversationRecord): Promise<void> {
    if (!conversation.customerId) {
      await this.meta.text(conversation.channelUserId, Templates.accountRequired());
      return this.mainMenu(conversation);
    }
    const result = await this.vehicles.listForCustomer(conversation.customerId);
    if (!result.scoped) {
      await this.meta.text(conversation.channelUserId, Templates.vehicleGap());
      return this.mainMenu(conversation);
    }
    if (!result.vehicles.length) {
      await this.meta.text(conversation.channelUserId, 'No vehicles are linked to your account. Add a vehicle in the customer app before booking on WhatsApp.');
      return this.mainMenu(conversation);
    }
    conversation.state = CONVERSATION_STATE.SELECT_VEHICLE;
    await this.meta.list(
      conversation.channelUserId,
      'Choose your vehicle:',
      'Vehicles',
      result.vehicles.slice(0, 10).map((vehicle) => ({
        id: `VEH:${vehicle.id}`,
        title: `${vehicle.brand ?? ''} ${vehicle.model ?? ''}`.trim() || vehicle.registrationNumber,
        description: `${vehicle.registrationNumber} ${vehicle.vehicleType}`.trim(),
      })),
    );
  }

  private async selectVehicle(conversation: ConversationRecord, vehicleId: string): Promise<void> {
    if (!conversation.customerId) return this.showVehicles(conversation);
    const result = await this.vehicles.listForCustomer(conversation.customerId);
    const vehicle = result.vehicles.find((item) => item.id === vehicleId);
    if (!vehicle) {
      await this.meta.text(conversation.channelUserId, 'That vehicle is not available. Please choose another.');
      return this.showVehicles(conversation);
    }
    conversation.context.vehicleId = vehicle.id;
    return this.showDates(conversation);
  }

  private async showDates(conversation: ConversationRecord): Promise<void> {
    conversation.state = CONVERSATION_STATE.SELECT_DATE;
    const rows: ListRow[] = this.nextDates().map((date) => ({ id: `DATE:${date}`, title: this.formatDate(date) }));
    await this.meta.list(conversation.channelUserId, 'Choose a date:', 'Dates', rows);
  }

  private async selectDate(conversation: ConversationRecord, date: string): Promise<void> {
    if (!this.nextDates().includes(date)) return this.showDates(conversation);
    return this.showSlots(conversation, date);
  }

  private async showSlots(conversation: ConversationRecord, date: string): Promise<void> {
    if (!conversation.context.vendorId) return this.showProviders(conversation);
    const slots = (await this.availability.slots(conversation.context.vendorId, date)).filter((slot) => this.slotOpen(slot));
    if (!slots.length) {
      await this.meta.text(conversation.channelUserId, Templates.noSlots());
      return this.showDates(conversation);
    }
    conversation.context.date = date;
    conversation.state = CONVERSATION_STATE.SELECT_SLOT;
    await this.meta.list(
      conversation.channelUserId,
      `Available slots for ${this.formatDate(date)}:`,
      'Slots',
      slots.slice(0, 10).map((slot) => ({
        id: `SLOT:${slot.id}`,
        title: slot.endTime ? `${slot.startTime}-${slot.endTime}` : slot.startTime,
        description: slot.available !== undefined ? `${slot.available} available` : undefined,
      })),
    );
  }

  private async selectSlot(conversation: ConversationRecord, slotId: string): Promise<void> {
    if (!conversation.context.vendorId || !conversation.context.date) return this.showDates(conversation);
    const slots = (await this.availability.slots(conversation.context.vendorId, conversation.context.date)).filter((slot) => this.slotOpen(slot));
    if (!slots.some((slot) => slot.id === slotId)) {
      await this.meta.text(conversation.channelUserId, Templates.slotTaken());
      return this.showSlots(conversation, conversation.context.date);
    }
    conversation.context.slotId = slotId;
    try {
      const price = await this.priceFor(conversation);
      conversation.context.price = price;
      conversation.context.couponCode = undefined;
      conversation.state = CONVERSATION_STATE.PRICE_REVIEW;
      await this.meta.buttons(conversation.channelUserId, `Price estimate\n\n${Templates.price(price)}\n\nDo you have a coupon?`, [
        { id: 'NO_COUPON', title: 'No Coupon' },
        { id: 'ADD_COUPON', title: 'Apply Coupon' },
        { id: 'BACK', title: 'Back' },
      ]);
    } catch (error) {
      if (this.isPricingGap(error)) {
        await this.meta.text(conversation.channelUserId, Templates.pricingGap());
        return this.mainMenu(conversation);
      }
      throw error;
    }
  }

  private async handlePriceReview(conversation: ConversationRecord, raw: string): Promise<void> {
    if (raw === 'ADD_COUPON') {
      conversation.state = CONVERSATION_STATE.COUPON;
      await this.meta.text(conversation.channelUserId, 'Please type your coupon code.');
      return;
    }
    if (raw === 'NO_COUPON') return this.showReview(conversation);
    return this.render(conversation);
  }

  private async handleCoupon(conversation: ConversationRecord, raw: string, action: string): Promise<void> {
    if (raw === 'NO_COUPON') return this.showReview(conversation);
    if (!action || raw.startsWith('MENU')) return this.render(conversation);
    if (conversation.context.couponCode && conversation.context.couponCode !== action.toUpperCase()) {
      await this.meta.text(conversation.channelUserId, 'Only one coupon can be applied. Reply NO_COUPON to continue with the current price.');
      return;
    }
    try {
      const validation = await this.pricing.validateCoupon(action, conversation.context.vendorId ?? '');
      if (!validation.valid) {
        await this.meta.text(conversation.channelUserId, validation.reason ?? 'That coupon is not valid. Try another code or choose No Coupon.');
        return;
      }
      conversation.context.couponCode = action.toUpperCase();
      conversation.context.price = await this.priceFor(conversation);
      return this.showReview(conversation);
    } catch (error) {
      if (this.isPricingGap(error)) {
        await this.meta.text(conversation.channelUserId, Templates.pricingGap());
        return this.mainMenu(conversation);
      }
      throw error;
    }
  }

  private async showReview(conversation: ConversationRecord): Promise<void> {
    if (!conversation.context.categoryId || !conversation.context.serviceId || !conversation.context.vendorId || !conversation.context.vehicleId || !conversation.context.price) {
      return this.mainMenu(conversation);
    }
    const service = await this.catalog.getService(conversation.context.categoryId, conversation.context.serviceId);
    const vendor = await this.vendors.get(conversation.context.vendorId);
    const vehicleResult = conversation.customerId ? await this.vehicles.listForCustomer(conversation.customerId) : { vehicles: [], scoped: true };
    const vehicle = vehicleResult.vehicles.find((item) => item.id === conversation.context.vehicleId);
    if (!vehicle) {
      await this.meta.text(conversation.channelUserId, 'The selected vehicle is no longer available.');
      return this.showVehicles(conversation);
    }
    conversation.state = CONVERSATION_STATE.BOOKING_REVIEW;
    await this.meta.buttons(
      conversation.channelUserId,
      [
        'Review your booking',
        `Service: ${service.name}`,
        `Provider: ${vendor.businessName ?? vendor.vendorId}`,
        `Vehicle: ${vehicle.registrationNumber}`,
        `Date: ${this.formatDate(conversation.context.date ?? '')}`,
        `Slot: ${conversation.context.slotId}`,
        conversation.context.couponCode ? `Coupon: ${conversation.context.couponCode}` : '',
        Templates.price(conversation.context.price),
      ].filter(Boolean).join('\n'),
      [{ id: 'CONFIRM_BOOKING', title: 'Confirm' }, { id: 'BACK', title: 'Back' }],
    );
  }

  private async confirmBooking(conversation: ConversationRecord): Promise<{ skipSave?: boolean } | void> {
    if (!conversation.customerId) {
      await this.meta.text(conversation.channelUserId, Templates.accountRequired());
      return this.mainMenu(conversation);
    }
    if (conversation.activeBookingId) return this.finishExistingBooking(conversation);
    const context = conversation.context;
    if (!context.vendorId || !context.vehicleId || !context.serviceId || !context.date || !context.slotId || !context.price) {
      return this.showReview(conversation);
    }
    if (!Number.isFinite(context.price.total) || context.price.total < 0) {
      throw new ChannelError(CHANNEL_ERROR_CODE.VALIDATION_ERROR, 'Price total is not valid');
    }

    await this.assertSlotStillOpen(context.slotId);
    let claim;
    try {
      claim = await this.store.claimBooking(conversation.channelUserId, conversation.version);
    } catch (error) {
      if (error instanceof ChannelError && error.code === CHANNEL_ERROR_CODE.CONFLICT) {
        const latest = await this.store.get(conversation.channelUserId);
        if (latest?.activeBookingId) {
          conversation.version = latest.version;
          conversation.activeBookingId = latest.activeBookingId;
          return this.finishExistingBooking(conversation);
        }
        await this.meta.text(conversation.channelUserId, Templates.confirmationInProgress());
        return { skipSave: true };
      }
      throw error;
    }
    conversation.version = claim.record.version;
    if (claim.status === 'exists' && claim.record.activeBookingId) {
      conversation.activeBookingId = claim.record.activeBookingId;
      return this.finishExistingBooking(conversation);
    }
    if (claim.status === 'inProgress') {
      await this.meta.text(conversation.channelUserId, Templates.confirmationInProgress());
      return { skipSave: true };
    }

    recordMetric(WHATSAPP_METRIC.BOOKING_STARTED);
    try {
      const created = await this.booking.create({
        customerId: conversation.customerId,
        vendorId: context.vendorId,
        vehicleId: context.vehicleId,
        serviceIds: [context.serviceId],
        bookingDate: context.date,
        slotId: context.slotId,
        totalAmount: context.price.total,
      });
      const attached = await this.store.attachBooking(conversation.channelUserId, created.id, conversation.version);
      conversation.version = attached.version;
      conversation.activeBookingId = created.id;
      conversation.context.bookingId = created.id;
      const confirmed = await this.booking.confirm(created.id);
      recordMetric(WHATSAPP_METRIC.BOOKING_COMPLETED);
      await this.showConfirmation(conversation, { ...created, ...confirmed, id: confirmed.id || created.id });
    } catch (error) {
      recordMetric(WHATSAPP_METRIC.BOOKING_FAILED);
      if (!conversation.activeBookingId) {
        await this.store.releaseBookingClaim(conversation.channelUserId, conversation.version);
        const released = await this.store.get(conversation.channelUserId);
        if (released) conversation.version = released.version;
      }
      if (error instanceof ChannelError && error.code === CHANNEL_ERROR_CODE.CONFLICT) {
        await this.meta.text(conversation.channelUserId, Templates.slotTaken());
        return this.showDates(conversation);
      }
      throw error;
    }
  }

  private async finishExistingBooking(conversation: ConversationRecord): Promise<void> {
    if (!conversation.activeBookingId) return this.showReview(conversation);
    let booking = await this.booking.get(conversation.activeBookingId);
    if (booking.bookingStatus === 'CREATED' || booking.bookingStatus === 'PENDING') {
      booking = await this.booking.confirm(booking.id || conversation.activeBookingId);
    }
    await this.showConfirmation(conversation, booking);
  }

  private async showConfirmation(conversation: ConversationRecord, booking: Booking): Promise<void> {
    conversation.context.bookingId = booking.id;
    conversation.activeBookingId = booking.id || conversation.activeBookingId;
    if (booking.paymentStatus === 'PAID') {
      conversation.state = CONVERSATION_STATE.BOOKED;
      recordMetric(WHATSAPP_METRIC.CONVERSATION_COMPLETED);
      await this.meta.text(conversation.channelUserId, Templates.booking(booking));
      return;
    }
    conversation.state = CONVERSATION_STATE.BOOKING_CONFIRMATION;
    await this.meta.buttons(conversation.channelUserId, Templates.paymentPending(booking), [{ id: 'MENU', title: 'Main menu' }]);
  }

  private async advanceConfirmation(conversation: ConversationRecord): Promise<void> {
    conversation.state = CONVERSATION_STATE.PAYMENT_PENDING;
    await this.meta.buttons(
      conversation.channelUserId,
      'Payment is still pending. There is no in-chat payment step yet. Reply MENU when you are done.',
      [{ id: 'MENU', title: 'Main menu' }],
    );
  }

  private async showBookings(conversation: ConversationRecord): Promise<void> {
    if (!conversation.customerId) {
      await this.meta.text(conversation.channelUserId, Templates.accountRequired());
      return this.mainMenu(conversation);
    }
    const bookings = await this.booking.listByCustomer(conversation.customerId);
    const today = this.isoDate(new Date());
    const upcoming = bookings.filter((item) => item.bookingStatus !== 'CANCELLED' && (item.bookingDate ?? '') >= today).slice(0, 10);
    conversation.state = CONVERSATION_STATE.MY_BOOKINGS;
    if (!upcoming.length) {
      await this.meta.text(conversation.channelUserId, 'You have no upcoming bookings.');
      return this.mainMenu(conversation);
    }
    await this.meta.list(conversation.channelUserId, 'Your upcoming bookings:', 'Bookings', upcoming.map((item) => ({
      id: `BOOK:${item.id}`,
      title: `${item.bookingDate ?? 'Booking'}`,
      description: `${item.bookingStatus ?? ''} ${item.id}`.trim(),
    })));
  }

  private async showBookingDetails(conversation: ConversationRecord, bookingId: string): Promise<void> {
    conversation.context.bookingId = bookingId;
    conversation.state = CONVERSATION_STATE.BOOKING_DETAILS;
    await this.meta.buttons(conversation.channelUserId, `Booking ${bookingId}\n\nWhat would you like to do?`, [
      { id: `CANCEL:${bookingId}`, title: 'Cancel' },
      { id: 'BACK', title: 'Back' },
    ]);
  }

  private async askCancel(conversation: ConversationRecord, bookingId: string): Promise<void> {
    if (!bookingId) return this.showBookings(conversation);
    conversation.context.bookingId = bookingId;
    conversation.state = CONVERSATION_STATE.CANCEL_BOOKING;
    await this.meta.buttons(conversation.channelUserId, `Cancel booking ${bookingId}?`, [
      { id: 'CONFIRM_CANCEL', title: 'Confirm cancel' },
      { id: 'BACK', title: 'Back' },
    ]);
  }

  private async cancelBooking(conversation: ConversationRecord): Promise<void> {
    const bookingId = conversation.context.bookingId;
    if (!bookingId) return this.showBookings(conversation);
    const cancelled = await this.booking.cancel(bookingId);
    conversation.context.bookingId = undefined;
    await this.meta.text(conversation.channelUserId, `Booking ${cancelled.id || bookingId} has been cancelled.`);
    return this.mainMenu(conversation);
  }

  private async priceFor(conversation: ConversationRecord) {
    if (!conversation.customerId && !conversation.context.vehicleId) {
      throw new ChannelError(CHANNEL_ERROR_CODE.VALIDATION_ERROR, 'Vehicle is required before pricing');
    }
    const vehicleResult = conversation.customerId ? await this.vehicles.listForCustomer(conversation.customerId) : { vehicles: [], scoped: true };
    const vehicle = vehicleResult.vehicles.find((item) => item.id === conversation.context.vehicleId);
    if (!vehicle) throw new ChannelError(CHANNEL_ERROR_CODE.NOT_FOUND, 'Selected vehicle is no longer available');
    return this.pricing.calculate({
      vendorId: conversation.context.vendorId ?? '',
      vehicleType: vehicle.vehicleType,
      serviceIds: [conversation.context.serviceId ?? ''],
      couponCode: conversation.context.couponCode,
    });
  }

  private async assertSlotStillOpen(slotId: string): Promise<void> {
    try {
      const slot = await this.availability.slot(slotId);
      if (!this.slotOpen(slot)) {
        throw new ChannelError(CHANNEL_ERROR_CODE.CONFLICT, 'Slot is no longer available');
      }
    } catch (error) {
      if (error instanceof ChannelError && error.code === CHANNEL_ERROR_CODE.UNAVAILABLE) {
        logger.warn({ event: 'slot_recheck_unavailable', slotId });
        return;
      }
      throw error;
    }
  }

  private slotOpen(slot: Slot): boolean {
    if (!slot.id) return false;
    if (slot.status && !['AVAILABLE', 'available', 'open'].includes(slot.status)) return false;
    if (slot.available !== undefined && slot.available <= 0) return false;
    return true;
  }

  private isPricingGap(error: unknown): boolean {
    if (!(error instanceof ChannelError)) return false;
    if (error.metadata?.gap === 'MISSING_CONTRACT') return true;
    return error.metadata?.dependency === 'pricing' && (error.code === CHANNEL_ERROR_CODE.NOT_FOUND || error.code === CHANNEL_ERROR_CODE.UNAVAILABLE);
  }

  private pageNote(text: string, count: number): string {
    return count > 10 ? `${text}\n\nShowing the first 10.` : text;
  }

  private nextDates(): string[] {
    const today = this.isoDate(new Date());
    return Array.from({ length: 7 }, (_, index) => this.addDays(today, index));
  }

  private isoDate(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.config.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  private addDays(iso: string, days: number): string {
    const utc = new Date(`${iso}T12:00:00Z`);
    utc.setUTCDate(utc.getUTCDate() + days);
    return this.isoDate(utc);
  }

  private formatDate(iso: string): string {
    if (!iso) return '';
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: this.config.timezone,
      day: '2-digit',
      month: 'short',
      weekday: 'short',
    }).format(new Date(`${iso}T12:00:00Z`));
  }
}
