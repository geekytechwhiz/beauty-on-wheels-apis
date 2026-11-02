import { LambdaRequest } from '@api-hub/utils';
import {
  ConditionalWriteConflictError,
  NotFoundError,
  ValidationError,
  isConditionalWriteConflictAtIndex,
} from '@api-hub/utils';
import { createLogger, createChildLogger } from '@api-hub/observability';

import {
  VendorsRepository,
  getVendorsRepository,
} from '../repositories/vendors.repository';
import {
  UpdateVendorOperatingHoursRequest,
  VendorOperatingPreferencesSection,
} from '../types/api-types';
import { VendorOperatingPreferencesDdbItem } from '../types/repository.types';
import { findDuplicateId } from '../domain/catalog-mapping';
import { isKnownServiceWindowId } from '../domain/service-windows';
import {
  VENDOR_OPERATING_PREFERENCES_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';
import {
  assertVendorAccess,
  getAuthenticatedUserId,
  getVendorId,
} from '../utils/helpers';

const baseLogger = createLogger({
  service: 'operating-hours-service',
  redactPII: true,
});

export class OperatingHoursService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'OperatingHoursService',
  });

  constructor(
    private readonly vendorsRepository: VendorsRepository = getVendorsRepository(),
  ) {}

  private async requireAccessibleVendor(request: LambdaRequest, vendorId: string) {
    const item = await this.vendorsRepository.getVendorById(vendorId);
    if (!item) {
      throw new NotFoundError('Vendor not found');
    }
    assertVendorAccess(request, item);
    return item;
  }

  async getvendoroperatinghours(
    request: LambdaRequest,
  ): Promise<VendorOperatingPreferencesSection> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);
    await this.requireAccessibleVendor(request, vendorId);
    const item = await this.vendorsRepository.getOperatingPreferences(vendorId);
    this.logger.info({
      event: 'getvendoroperatinghours_success',
      userId,
      vendorId,
      count: item?.serviceWindowIds.length ?? 0,
    });
    return toSection(vendorId, item);
  }

  async updatevendoroperatinghours(
    request: LambdaRequest,
  ): Promise<VendorOperatingPreferencesSection> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);
    const body = request.body as UpdateVendorOperatingHoursRequest;
    await this.requireAccessibleVendor(request, vendorId);

    const serviceWindowIds = normalizeServiceWindowIds(body.serviceWindowIds);
    const existing = await this.vendorsRepository.getOperatingPreferences(vendorId);
    if (
      existing &&
      sameWindowIds(existing.serviceWindowIds, serviceWindowIds)
    ) {
      return toSection(vendorId, existing);
    }

    const timestamp = new Date().toISOString();
    const item: VendorOperatingPreferencesDdbItem = {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.operatingPreferencesSk(),
      vendorId,
      serviceWindowIds,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      entityType: VENDOR_OPERATING_PREFERENCES_ENTITY_TYPE,
    };

    try {
      await this.vendorsRepository.putOperatingPreferences(item);
    } catch (err) {
      if (
        isConditionalWriteConflictAtIndex(err, 0) ||
        err instanceof ConditionalWriteConflictError
      ) {
        throw new NotFoundError('Vendor not found');
      }
      throw err;
    }

    this.logger.info({
      event: 'updatevendoroperatinghours_success',
      userId,
      vendorId,
      count: serviceWindowIds.length,
    });
    return toSection(vendorId, item);
  }
}

function normalizeServiceWindowIds(values: string[]): string[] {
  const duplicate = findDuplicateId(values);
  if (duplicate) {
    throw new ValidationError(`Duplicate service window: ${duplicate}`);
  }
  for (const value of values) {
    if (!isKnownServiceWindowId(value)) {
      throw new ValidationError(`Unknown service window: ${value}`);
    }
  }
  return [...values];
}

function sameWindowIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function toSection(
  vendorId: string,
  item: VendorOperatingPreferencesDdbItem | null,
): VendorOperatingPreferencesSection {
  return {
    vendorId,
    serviceWindowIds: item?.serviceWindowIds ?? [],
    updatedAt: item?.updatedAt ?? '',
  };
}

let service: OperatingHoursService;

export function getOperatingHoursService() {
  if (!service) {
    service = new OperatingHoursService();
  }

  return service;
}
