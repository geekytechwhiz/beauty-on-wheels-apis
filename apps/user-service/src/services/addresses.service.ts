import { randomUUID } from 'crypto';
import {
  ConditionalWriteConflictError,
  LambdaRequest,
  NotFoundError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { ADDRESS_STATUS } from '../domain/constants';
import {
  planCreateDefault,
  planDeleteDefault,
  planUpdateDefault,
} from '../domain/default-address';
import { toAddress, toAddressRecord } from '../mappers/addresses.mapper';
import {
  AddressesRepository,
  getAddressesRepository,
} from '../repositories/addresses.repository';
import {
  CustomersRepository,
  getCustomersRepository,
} from '../repositories/customers.repository';
import {
  Address,
  AddressListResponse,
  AddressRequest,
} from '../types/api-types';
import { AddressRecord } from '../types/records';
import { assertOwnerAdminOrService, assertOwnerOrAdmin, getPathParam, getUserId } from '../utils';

const baseLogger = createLogger({
  service: 'addresses-service',
  redactPII: true,
});

function activeAddresses(records: AddressRecord[]): AddressRecord[] {
  return records.filter((record) => record.status === ADDRESS_STATUS.ACTIVE);
}

export class AddressesService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'AddressesService',
  });

  constructor(
    private readonly addresses: AddressesRepository = getAddressesRepository(),
    private readonly customers: CustomersRepository = getCustomersRepository(),
  ) {}

  async listAddresses(request: LambdaRequest): Promise<AddressListResponse> {
    const userId = getUserId(request);
    assertOwnerAdminOrService(request, userId);
    await this.requireProfile(userId);

    const records = activeAddresses(await this.addresses.listByUser(userId));
    const items = records
      .map((record) => toAddress(record))
      .sort((left, right) => {
        if (left.isDefault !== right.isDefault) {
          return left.isDefault ? -1 : 1;
        }
        return right.createdAt.localeCompare(left.createdAt);
      });

    return { items };
  }

  async createAddress(request: LambdaRequest): Promise<Address> {
    const userId = getUserId(request);
    assertOwnerOrAdmin(request, userId);
    const profile = await this.requireProfile(userId);
    const body = request.body as AddressRequest;
    const now = new Date().toISOString();
    const addressId = randomUUID();
    const existing = activeAddresses(await this.addresses.listByUser(userId));
    const plan = planCreateDefault({
      addressId,
      requestedDefault: body.isDefault,
      active: existing,
      currentDefaultAddressId: profile.defaultAddressId,
    });

    const address = toAddressRecord({
      userId,
      addressId,
      body,
      isDefault: plan.isDefault,
      status: ADDRESS_STATUS.ACTIVE,
      createdAt: now,
      updatedAt: now,
    });
    const previous = plan.clearAddressId
      ? existing.find((item) => item.addressId === plan.clearAddressId)
      : undefined;

    await this.addresses.writeAddress({
      address,
      expectExisting: false,
      clearAddress: previous
        ? { ...previous, isDefault: false, updatedAt: now }
        : undefined,
      profileUpdate: this.profileUpdate(
        userId,
        profile.defaultAddressId,
        plan.defaultAddressId,
        now,
      ),
    });

    this.logger.info({
      event: 'create_address_success',
      userId,
      addressId,
      isDefault: plan.isDefault,
    });

    return toAddress(address);
  }

  async updateAddress(request: LambdaRequest): Promise<Address> {
    const userId = getUserId(request);
    assertOwnerOrAdmin(request, userId);
    const profile = await this.requireProfile(userId);
    const addressId = getPathParam(request, 'addressId');
    const current = await this.requireActiveAddress(userId, addressId);
    const body = request.body as AddressRequest;
    const now = new Date().toISOString();
    const existing = activeAddresses(await this.addresses.listByUser(userId));
    const others = existing.filter((item) => item.addressId !== addressId);
    const plan = planUpdateDefault({
      addressId,
      wasDefault: current.isDefault,
      requestedDefault: body.isDefault,
      activeOthers: others,
      currentDefaultAddressId: profile.defaultAddressId,
    });

    const address = toAddressRecord({
      userId,
      addressId,
      body: {
        type: body.type ?? current.type,
        line1: body.line1,
        line2: body.line2,
        city: body.city,
        state: body.state,
        postalCode: body.postalCode,
        country: body.country,
        latitude: body.latitude,
        longitude: body.longitude,
        isDefault: plan.isDefault,
      },
      isDefault: plan.isDefault,
      status: ADDRESS_STATUS.ACTIVE,
      createdAt: current.createdAt,
      updatedAt: now,
    });

    const clearAddress = plan.clearAddressId
      ? others.find((item) => item.addressId === plan.clearAddressId)
      : undefined;
    const promoteAddress = plan.promoteAddressId
      ? others.find((item) => item.addressId === plan.promoteAddressId)
      : undefined;

    try {
      await this.addresses.writeAddress({
        address,
        expectExisting: true,
        clearAddress: clearAddress
          ? { ...clearAddress, isDefault: false, updatedAt: now }
          : undefined,
        promoteAddress: promoteAddress
          ? { ...promoteAddress, isDefault: true, updatedAt: now }
          : undefined,
        profileUpdate: this.profileUpdate(
          userId,
          profile.defaultAddressId,
          plan.defaultAddressId,
          now,
        ),
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new NotFoundError('Address not found');
      }
      throw error;
    }

    this.logger.info({
      event: 'update_address_success',
      userId,
      addressId,
    });

    return toAddress(address);
  }

  async deleteAddress(request: LambdaRequest): Promise<{ id: string; deleted: true }> {
    const userId = getUserId(request);
    assertOwnerOrAdmin(request, userId);
    const profile = await this.requireProfile(userId);
    const addressId = getPathParam(request, 'addressId');
    const current = await this.requireActiveAddress(userId, addressId);
    const now = new Date().toISOString();
    const others = activeAddresses(await this.addresses.listByUser(userId)).filter(
      (item) => item.addressId !== addressId,
    );
    const plan = planDeleteDefault({
      wasDefault: current.isDefault,
      activeOthers: others,
      currentDefaultAddressId: profile.defaultAddressId,
    });
    const promoteAddress = plan.promoteAddressId
      ? others.find((item) => item.addressId === plan.promoteAddressId)
      : undefined;

    const deleted: AddressRecord = {
      ...current,
      isDefault: false,
      status: ADDRESS_STATUS.DELETED,
      updatedAt: now,
    };

    await this.addresses.writeAddress({
      address: deleted,
      expectExisting: true,
      promoteAddress: promoteAddress
        ? { ...promoteAddress, isDefault: true, updatedAt: now }
        : undefined,
      profileUpdate: this.profileUpdate(
        userId,
        profile.defaultAddressId,
        plan.defaultAddressId,
        now,
      ),
    });

    this.logger.info({
      event: 'delete_address_success',
      userId,
      addressId,
    });

    return { id: addressId, deleted: true };
  }

  private profileUpdate(
    userId: string,
    currentDefaultAddressId: string | undefined,
    nextDefaultAddressId: string | null | undefined,
    updatedAt: string,
  ) {
    const current = currentDefaultAddressId ?? null;
    const next =
      nextDefaultAddressId === undefined ? current : nextDefaultAddressId;
    if (current === next) {
      return undefined;
    }
    return {
      userId,
      defaultAddressId: next,
      updatedAt,
    };
  }

  private async requireProfile(userId: string) {
    const profile = await this.customers.getProfile(userId);
    if (!profile) {
      throw new NotFoundError('Customer profile not found');
    }
    return profile;
  }

  private async requireActiveAddress(
    userId: string,
    addressId: string,
  ): Promise<AddressRecord> {
    const address = await this.addresses.getAddress(userId, addressId);
    if (!address || address.status !== ADDRESS_STATUS.ACTIVE) {
      throw new NotFoundError('Address not found');
    }
    return address;
  }
}

let service: AddressesService;

export function getAddressesService(): AddressesService {
  if (!service) {
    service = new AddressesService();
  }
  return service;
}
