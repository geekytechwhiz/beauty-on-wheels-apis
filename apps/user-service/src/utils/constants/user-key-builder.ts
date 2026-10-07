export const PROFILE_SK = 'PROFILE';
export const PREFERENCES_SK = 'PREFERENCES';
export const PHONE_LOOKUP_SK = 'LOOKUP';
export const COMMUNITY_META_SK = 'META';
export const ADDRESS_SK_PREFIX = 'ADDR#';
export const MEMBERSHIP_SK_PREFIX = 'MEMBER#';

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

  phonePk: (e164: string) => `PHONE#${e164.trim()}`,

  phoneSk: () => PHONE_LOOKUP_SK,

  communityPk: (communityId: string) => `COMMUNITY#${communityId.trim()}`,

  communitySk: () => COMMUNITY_META_SK,

  communityListPk: () => COMMUNITY_LIST_PK,

  communityListSk: (createdAt: string, communityId: string) =>
    `${createdAt}#${communityId}`,
};
