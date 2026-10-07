export const CHANNEL = {
  WHATSAPP: 'whatsapp',
} as const;

export type Channel = (typeof CHANNEL)[keyof typeof CHANNEL];

export const CONVERSATION_STATE = {
  WELCOME: 'welcome',
  MAIN_MENU: 'mainMenu',
  BROWSE_CATEGORY: 'browseCategory',
  SELECT_SERVICE: 'selectService',
  SELECT_PROVIDER: 'selectProvider',
  SELECT_VEHICLE: 'selectVehicle',
  SELECT_DATE: 'selectDate',
  SELECT_SLOT: 'selectSlot',
  PRICE_REVIEW: 'priceReview',
  COUPON: 'coupon',
  BOOKING_REVIEW: 'bookingReview',
  BOOKING_CONFIRMATION: 'bookingConfirmation',
  PAYMENT_PENDING: 'paymentPending',
  BOOKED: 'booked',
  MY_BOOKINGS: 'myBookings',
  BOOKING_DETAILS: 'bookingDetails',
  CANCEL_BOOKING: 'cancelBooking',
  HELP: 'help',
  ERROR: 'error',
  EXPIRED: 'expired',
} as const;

export type ConversationState = (typeof CONVERSATION_STATE)[keyof typeof CONVERSATION_STATE];

export interface Category {
  id: string;
  name: string;
  description?: string;
  displayOrder?: number;
  active?: boolean;
}

export interface CatalogService {
  id: string;
  categoryId?: string;
  name: string;
  description?: string;
  durationMinutes?: number;
  vehicleTypes?: string[];
  basePrice?: number;
  active?: boolean;
}

export interface Vehicle {
  id: string;
  userId?: string;
  registrationNumber: string;
  vehicleType: string;
  brand?: string;
  model?: string;
}

export interface VendorSummary {
  vendorId: string;
  businessName?: string;
  status?: string;
  operationalStatus?: string;
}

export interface Slot {
  id: string;
  vendorId?: string;
  date?: string;
  startTime: string;
  endTime?: string;
  available?: number;
  status?: string;
}

export interface PriceBreakdown {
  subtotal?: number;
  discount?: number;
  tax?: number;
  convenienceFee?: number;
  total: number;
  currency?: string;
  appliedCoupons?: string[];
}

export interface CouponValidation {
  valid: boolean;
  reason?: string;
}

export interface Booking {
  id: string;
  customerId?: string;
  vendorId?: string;
  vehicleId?: string;
  serviceIds?: string[];
  bookingDate?: string;
  slotId?: string;
  totalAmount?: number;
  paymentStatus?: 'PENDING' | 'PAID' | 'REFUNDED';
  bookingStatus?: string;
}

export interface ConversationContext {
  categoryId?: string;
  serviceId?: string;
  vendorId?: string;
  vehicleId?: string;
  date?: string;
  slotId?: string;
  couponCode?: string;
  price?: PriceBreakdown;
  bookingId?: string;
}

export interface ConversationRecord {
  conversationId: string;
  channel: Channel;
  channelUserId: string;
  customerId?: string;
  state: ConversationState;
  context: ConversationContext;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
  version: number;
  activeBookingId?: string;
  bookingClaim?: string;
  bookingClaimExpiresAt?: number;
  lastMessageId?: string;
}

export interface ChannelIdentity {
  channel: Channel;
  channelUserId: string;
  phoneNumber: string;
  customerId?: string;
  profileName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MarketingConsent {
  channel: Channel;
  channelUserId: string;
  optedIn: boolean;
  updatedAt: string;
}

export type BookingClaimStatus = 'claimed' | 'exists' | 'inProgress';

export interface BookingClaimResult {
  status: BookingClaimStatus;
  record: ConversationRecord;
}
