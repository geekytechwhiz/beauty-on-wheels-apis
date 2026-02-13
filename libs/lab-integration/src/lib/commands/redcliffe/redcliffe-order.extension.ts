import type {
  BaseCreateOrderCommand,
  BaseRescheduleOrderCommand,
} from '../base/base-order.command';

/**
 * Redcliffe-specific fields for order creation.
 * These extend the base command with partner-specific requirements.
 */
export interface RedcliffeCreateOrderExtension {
  bookingDate?: string; // YYYY-MM-DD format
  collectionDate?: string; // YYYY-MM-DD format
  collectionSlot?: number; // Slot ID
  customerAddress?: string;
  customerAge?: string;
  customerAltPhoneNumber?: string;
  customerEmail?: string;
  customerGender?: 'male' | 'female';
  customerLatitude?: number;
  customerLongitude?: number;
  customerPhoneNumber?: string;
  customerWhatsAppNumber?: string;
  isCredit?: boolean;
  landmark?: string;
  pincode?: string;
  referenceData?: string;
  additionalMember?: Array<{
    customerName: string;
    nameTrue: boolean;
    customerAge: string;
    customerGender: 'male' | 'female';
    packageCode: string[];
  }>;
}

export type RedcliffeCreateOrderCommand = BaseCreateOrderCommand &
  RedcliffeCreateOrderExtension;

export interface RedcliffeRescheduleOrderExtension {
  collectionDate: string;
  collectionSlot: number;
  remark?: string;
}

export type RedcliffeRescheduleOrderCommand = BaseRescheduleOrderCommand &
  RedcliffeRescheduleOrderExtension;
