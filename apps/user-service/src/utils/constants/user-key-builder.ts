export const PROFILE_SK = 'PROFILE';
export const PREFERENCES_SK = 'PREFERENCES';
export const PHONE_LOOKUP_SK = 'LOOKUP';
export const COMMUNITY_META_SK = 'META';
export const ADDRESS_SK_PREFIX = 'ADDR#';
export const MEMBERSHIP_SK_PREFIX = 'MEMBER#';

export const SUPPORT_TICKET_SK_PREFIX = 'SUPPORT_TICKET#';
export const SUPPORT_TICKET_IDEMPOTENCY_SK_PREFIX = 'SUPPORT_TICKET_IDEMPOTENCY#';

export const GSI1_INDEX = 'GSI1';
export const COMMUNITY_LIST_PK = 'COMMUNITY';

export const UserKeyBuilder = {
  userPk: (userId: string) => `USER#${userId.trim()}`,

  profileSk: () => PROFILE_SK,

  preferencesSk: () => PREFERENCES_SK,

  addressSk: (addressId: string) => `${ADDRESS_SK_PREFIX}${addressId.trim()}`,

  addressSkPrefix: () => ADDRESS_SK_PREFIX,

  membershipSk: (communityId: string) =>
    `${MEMBERSHIP_SK_PREFIX}${communityId.trim()}`,

  membershipSkPrefix: () => MEMBERSHIP_SK_PREFIX,

  supportTicketSk: (ticketId: string) =>
    `${SUPPORT_TICKET_SK_PREFIX}${ticketId.trim()}`,

  supportTicketSkPrefix: () => SUPPORT_TICKET_SK_PREFIX,

  supportTicketIdempotencySk: (key: string) =>
    `${SUPPORT_TICKET_IDEMPOTENCY_SK_PREFIX}${key.trim()}`,

  phonePk: (e164: string) => `PHONE#${e164.trim()}`,

  phoneSk: () => PHONE_LOOKUP_SK,

  identityPk: (identityId: string) => `IDENTITY#${identityId.trim()}`,

  identitySk: () => PHONE_LOOKUP_SK,

  communityPk: (communityId: string) => `COMMUNITY#${communityId.trim()}`,

  communitySk: () => COMMUNITY_META_SK,

  communityListPk: () => COMMUNITY_LIST_PK,

  communityListSk: (createdAt: string, communityId: string) =>
    `${createdAt}#${communityId}`,
};
