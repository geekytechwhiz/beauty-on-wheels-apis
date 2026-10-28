import { ADDRESS_TYPE, ENTITY_TYPE } from '../domain/constants';
import { Address, AddressRequest } from '../types/api-types';
import { AddressRecord } from '../types/records';
import { UserKeyBuilder, withoutUndefined } from '../utils';

export function toAddress(record: AddressRecord): Address {
  return {
    id: record.addressId,
    userId: record.userId,
    type: record.type,
    communityId: record.communityId,
    line1: record.line1,
    city: record.city,
    state: record.state,
    isDefault: record.isDefault,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.line2 ? { line2: record.line2 } : {}),
    ...(record.postalCode ? { postalCode: record.postalCode } : {}),
  };
}

export function toAddressRecord(input: {
  userId: string;
  addressId: string;
  body: AddressRequest;
  isDefault: boolean;
  status: AddressRecord['status'];
  createdAt: string;
  updatedAt: string;
}): AddressRecord {
  return withoutUndefined({
    PK: UserKeyBuilder.userPk(input.userId),
    SK: UserKeyBuilder.addressSk(input.addressId),
    entityType: ENTITY_TYPE.ADDRESS,
    addressId: input.addressId,
    userId: input.userId,
    type: input.body.type ?? ADDRESS_TYPE.HOME,
    communityId: input.body.communityId,
    line1: input.body.line1,
    line2: input.body.line2,
    city: input.body.city,
    state: input.body.state,
    postalCode: input.body.postalCode,
    isDefault: input.isDefault,
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
}
