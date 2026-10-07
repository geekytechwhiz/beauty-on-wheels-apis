import { ADDRESS_TYPE, ENTITY_TYPE } from '../domain/constants';
import { Address, AddressRequest } from '../types/api-types';
import { AddressRecord } from '../types/records';
import { UserKeyBuilder, withoutUndefined } from '../utils';

export function toAddress(record: AddressRecord): Address {
  return {
    id: record.addressId,
    userId: record.userId,
    type: record.type,
    line1: record.line1,
    city: record.city,
    isDefault: record.isDefault,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.line2 ? { line2: record.line2 } : {}),
    ...(record.state ? { state: record.state } : {}),
    ...(record.postalCode ? { postalCode: record.postalCode } : {}),
    ...(record.country ? { country: record.country } : {}),
    ...(record.latitude !== undefined ? { latitude: record.latitude } : {}),
    ...(record.longitude !== undefined ? { longitude: record.longitude } : {}),
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
    line1: input.body.line1,
    line2: input.body.line2,
    city: input.body.city,
    state: input.body.state,
    postalCode: input.body.postalCode,
    country: input.body.country,
    latitude: input.body.latitude,
    longitude: input.body.longitude,
    isDefault: input.isDefault,
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
}
