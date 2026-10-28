import {
  AddressStatus,
  AddressType,
  CommunityStatus,
  EntityType,
  UserStatus,
} from '../domain/constants';

export interface CustomerProfileRecord {
  PK: string;
  SK: string;
  entityType: EntityType;
  userId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  profileImage?: string;
  status: UserStatus;
  preferredLanguage?: string;
  loyaltyPoints?: number;
  communityIds: string[];
  defaultAddressId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PhoneLookupRecord {
  PK: string;
  SK: string;
  entityType: EntityType;
  userId: string;
  phone: string;
  status: UserStatus;
}

/** One-to-one, concurrency-safe bridge from Cognito identity to application user. */
export interface IdentityUserLookupRecord {
  PK: string;
  SK: string;
  entityType: 'IdentityUserLookup';
  identityId: string;
  userId: string;
  createdAt: string;
}

export interface AddressRecord {
  PK: string;
  SK: string;
  entityType: EntityType;
  addressId: string;
  userId: string;
  type: AddressType;
  communityId: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  isDefault: boolean;
  status: AddressStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OperationalPreferencesRecord {
  PK: string;
  SK: string;
  entityType: EntityType;
  userId: string;
  whatsapp: boolean;
  sms: boolean;
  email: boolean;
  push: boolean;
  language?: string;
  timezone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityRecord {
  PK: string;
  SK: string;
  entityType: EntityType;
  communityId: string;
  name: string;
  code?: string;
  city?: string;
  status: CommunityStatus;
  GSI1PK: string;
  GSI1SK: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityMembershipRecord {
  PK: string;
  SK: string;
  entityType: EntityType;
  userId: string;
  communityId: string;
  createdAt: string;
}

export interface ProfilePhoneChange {
  previousPhone?: string;
}

export interface AddressWrite {
  address: AddressRecord;
  expectExisting: boolean;
  clearAddress?: AddressRecord;
  promoteAddress?: AddressRecord;
  profileUpdate?: {
    userId: string;
    defaultAddressId: string | null;
    updatedAt: string;
  };
}

export interface MembershipReplacement {
  userId: string;
  communityIds: string[];
  updatedAt: string;
  toPut: CommunityMembershipRecord[];
  toDelete: string[];
}

export type SupportTicketCategory = 'BOOKING' | 'PAYMENT' | 'ACCOUNT';
export type SupportTicketStatus = 'OPEN';

/** PK USER#{userId}, SK SUPPORT_TICKET#{ticketId}. */
export interface SupportTicketRecord {
  PK: string;
  SK: string;
  entityType: EntityType;
  ticketId: string;
  userId: string;
  status: SupportTicketStatus;
  category: SupportTicketCategory;
  message: string;
  bookingId?: string;
  submittedAt: string;
  updatedAt: string;
}

/** PK USER#{userId}, SK SUPPORT_TICKET_IDEMPOTENCY#{key}. Written atomically with the ticket. */
export interface SupportTicketIdempotencyRecord {
  PK: string;
  SK: string;
  entityType: EntityType;
  ticketId: string;
  userId: string;
  requestHash: string;
  createdAt: string;
}
