import { ENTITY_TYPE, USER_STATUS } from '../domain/constants';
import {
  CustomerProfile,
  CustomerProfileUpdate,
  PhoneLookupResult,
  User,
} from '../types/api-types';
import {
  CustomerProfileRecord,
  PhoneLookupRecord,
} from '../types/records';
import { UserKeyBuilder, withoutUndefined } from '../utils';

export function toCustomerProfile(record: CustomerProfileRecord): CustomerProfile {
  return {
    userId: record.userId,
    status: record.status,
    communityIds: record.communityIds ?? [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.firstName ? { firstName: record.firstName } : {}),
    ...(record.lastName ? { lastName: record.lastName } : {}),
    ...(record.email ? { email: record.email } : {}),
    ...(record.phone ? { phone: record.phone } : {}),
    ...(record.profileImage ? { profileImage: record.profileImage } : {}),
    ...(record.preferredLanguage
      ? { preferredLanguage: record.preferredLanguage }
      : {}),
    ...(record.loyaltyPoints !== undefined
      ? { loyaltyPoints: record.loyaltyPoints }
      : {}),
    ...(record.defaultAddressId
      ? { defaultAddressId: record.defaultAddressId }
      : {}),
  };
}

export function toUser(record: CustomerProfileRecord): User {
  return {
    id: record.userId,
    status: record.status,
    ...(record.firstName ? { firstName: record.firstName } : {}),
    ...(record.lastName ? { lastName: record.lastName } : {}),
    ...(record.email ? { email: record.email } : {}),
    ...(record.phone ? { phone: record.phone } : {}),
    ...(record.profileImage ? { profileImage: record.profileImage } : {}),
  };
}

export function toPhoneLookupResult(record: PhoneLookupRecord): PhoneLookupResult {
  return {
    id: record.userId,
    phone: record.phone,
    status: record.status,
  };
}

export function toPhoneLookupRecord(
  record: CustomerProfileRecord,
): PhoneLookupRecord | undefined {
  if (!record.phone) {
    return undefined;
  }

  return {
    PK: UserKeyBuilder.phonePk(record.phone),
    SK: UserKeyBuilder.phoneSk(),
    entityType: ENTITY_TYPE.PHONE_LOOKUP,
    userId: record.userId,
    phone: record.phone,
    status: record.status,
  };
}

export function applyProfileFields(
  existing: CustomerProfileRecord | undefined,
  userId: string,
  body: CustomerProfileUpdate,
  now: string,
): CustomerProfileRecord {
  const createdAt = existing?.createdAt ?? now;

  return withoutUndefined({
    PK: UserKeyBuilder.userPk(userId),
    SK: UserKeyBuilder.profileSk(),
    entityType: ENTITY_TYPE.CUSTOMER_PROFILE,
    userId,
    status: body.status ?? existing?.status ?? USER_STATUS.ACTIVE,
    communityIds: existing?.communityIds ?? [],
    createdAt,
    updatedAt: now,
    firstName: body.firstName ?? existing?.firstName,
    lastName: body.lastName ?? existing?.lastName,
    email: body.email ?? existing?.email,
    phone: body.phone === null ? undefined : (body.phone ?? existing?.phone),
    profileImage: body.profileImage ?? existing?.profileImage,
    preferredLanguage: body.preferredLanguage ?? existing?.preferredLanguage,
    loyaltyPoints: body.loyaltyPoints ?? existing?.loyaltyPoints,
    defaultAddressId: existing?.defaultAddressId,
  });
}
