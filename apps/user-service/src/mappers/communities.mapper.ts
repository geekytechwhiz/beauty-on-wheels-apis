import { ENTITY_TYPE } from '../domain/constants';
import { Community, CommunityDirectoryItem } from '../types/api-types';
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
    ...(record.cityId ? { cityId: record.cityId } : {}),
    ...(record.locality ? { locality: record.locality } : {}),
    ...(record.localityId ? { localityId: record.localityId } : {}),
    ...(record.postalCode ? { postalCode: record.postalCode } : {}),
    ...(record.accessType ? { accessType: record.accessType } : {}),
    ...(record.streetAddress ? { streetAddress: record.streetAddress } : {}),
    ...(record.contactPersonName ? { contactPersonName: record.contactPersonName } : {}),
    ...(record.contactPersonTitle ? { contactPersonTitle: record.contactPersonTitle } : {}),
    ...(record.contactPhone ? { contactPhone: record.contactPhone } : {}),
    ...(record.contactEmail ? { contactEmail: record.contactEmail } : {}),
    ...(record.totalResidentialUnits !== undefined
      ? { totalResidentialUnits: record.totalResidentialUnits }
      : {}),
    ...(record.estimatedVehicleCount !== undefined
      ? { estimatedVehicleCount: record.estimatedVehicleCount }
      : {}),
    ...(record.leadSource ? { leadSource: record.leadSource } : {}),
    ...(record.intakeNotes ? { intakeNotes: record.intakeNotes } : {}),
  };
}

export function toCommunityDirectoryItem(record: CommunityRecord): CommunityDirectoryItem {
  return {
    communityId: record.communityId,
    name: record.name,
    ...(record.city ? { city: record.city } : {}),
    ...(record.cityId ? { cityId: record.cityId } : {}),
    ...(record.locality ? { locality: record.locality } : {}),
    ...(record.localityId ? { localityId: record.localityId } : {}),
    ...(record.postalCode ? { postalCode: record.postalCode } : {}),
    ...(record.accessType ? { accessType: record.accessType } : {}),
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
