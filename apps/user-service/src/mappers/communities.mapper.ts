import { ENTITY_TYPE } from '../domain/constants';
import { Community } from '../types/api-types';
import { CommunityMembershipRecord, CommunityRecord } from '../types/records';
import { UserKeyBuilder } from '../utils';

export function toCommunity(record: CommunityRecord): Community {
  return {
    communityId: record.communityId,
    name: record.name,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.code ? { code: record.code } : {}),
    ...(record.city ? { city: record.city } : {}),
  };
}

export function toMembershipRecord(input: {
  userId: string;
  communityId: string;
  createdAt: string;
}): CommunityMembershipRecord {
  return {
    PK: UserKeyBuilder.userPk(input.userId),
    SK: UserKeyBuilder.membershipSk(input.communityId),
    entityType: ENTITY_TYPE.COMMUNITY_MEMBERSHIP,
    userId: input.userId,
    communityId: input.communityId,
    createdAt: input.createdAt,
  };
}
