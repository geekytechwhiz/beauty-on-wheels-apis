import { Booking, PriceBreakdown } from '../types/domain';

export const Templates = {
  welcome: (businessName: string) => `Welcome to ${businessName}.\n\nHow can we help you today?`,
  price: (price: PriceBreakdown) => {
    const currency = price.currency ?? 'INR';
    return [
      `Subtotal: ${currency} ${price.subtotal ?? 0}`,
      `Discount: ${currency} ${price.discount ?? 0}`,
      `Tax: ${currency} ${price.tax ?? 0}`,
      `Convenience fee: ${currency} ${price.convenienceFee ?? 0}`,
      `Total: ${currency} ${price.total}`,
    ].join('\n');
  },
  booking: (booking: Booking) =>
    `Booking confirmed\n\nBooking ID: ${booking.id}\nDate: ${booking.bookingDate ?? ''}\nSlot: ${booking.slotId ?? ''}\nAmount: ${booking.totalAmount ?? ''}`,
  paymentPending: (booking: Booking) =>
    `${Templates.booking(booking)}\n\nPayment is still pending. In-chat payment is not available yet.`,
  expired: () => 'Your previous session expired. Let’s start again.',
  help: () => 'Reply MENU for the main menu, MY BOOKINGS to see upcoming bookings, or STOP to opt out of marketing messages.',
  unsubscribed: () => 'You have been unsubscribed from marketing messages. Transactional booking messages may still be sent.',
  subscribed: () => 'You are now subscribed to marketing messages.',
  accountRequired: () => 'Your WhatsApp number is not linked to a customer profile yet. Please complete customer onboarding before booking.',
  vehicleGap: () => 'Vehicles cannot be listed for this WhatsApp number yet. The Vehicle Service returns only the signed-in customer’s vehicles, and this chat does not have that session.',
  pricingGap: () => 'Pricing is not available yet, so this booking cannot be confirmed from WhatsApp.',
  noProviders: () => 'No providers are available for the pilot right now.',
  noSlots: () => 'No slots are available on that date. Please choose another date.',
  slotTaken: () => 'That slot was just taken. Please choose another slot.',
  confirmationInProgress: () => 'Your booking confirmation is already in progress. Please wait a moment and reply MENU if you do not receive a confirmation.',
};
