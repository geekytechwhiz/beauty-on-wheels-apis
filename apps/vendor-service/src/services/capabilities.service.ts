import { LambdaRequest } from '@api-hub/utils';
import {
  ConditionalWriteConflictError,
  NotFoundError,
  isConditionalWriteConflictAtIndex,
} from '@api-hub/utils';
import { createLogger, createChildLogger } from '@api-hub/observability';

import {
  CapabilitiesRepository,
  getCapabilitiesRepository,
} from '../repositories/capabilities.repository';
import {
  VendorsRepository,
  getVendorsRepository,
} from '../repositories/vendors.repository';
import { CapabilitiesMapper } from '../mappers/capabilities.mapper';
import {
  AvailableCapabilities,
  UpdateVendorCapabilitiesRequest,
  VendorCapabilities,
} from '../types/api-types';
import {
  CAPABILITY_CATALOG_SOURCE,
  listAvailableCapabilities,
} from '../domain/capabilities-catalog';
import {
  assertVendorAccess,
  getAuthenticatedUserId,
  getVendorId,
} from '../utils/helpers';

const baseLogger = createLogger({
  service: 'capabilities-service',
  redactPII: true,
});

export class CapabilitiesService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'CapabilitiesService',
  });

  constructor(
    private readonly repository: CapabilitiesRepository = getCapabilitiesRepository(),
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

  async listavailablecapabilities(
    request: LambdaRequest,
  ): Promise<AvailableCapabilities> {
    getAuthenticatedUserId(request);
    return {
      vehicleTypes: listAvailableCapabilities(),
      catalogSources: { ...CAPABILITY_CATALOG_SOURCE },
    };
  }

  async getvendorcapabilities(
    request: LambdaRequest,
  ): Promise<VendorCapabilities> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);

    this.logger.info({
      event: 'getvendorcapabilities_start',
      userId,
      vendorId,
    });

    try {
      await this.requireAccessibleVendor(request, vendorId);
      const item = await this.repository.getCapabilities(vendorId);
      const result = item
        ? CapabilitiesMapper.toDomain(item)
        : CapabilitiesMapper.empty(vendorId);

      this.logger.info({
        event: 'getvendorcapabilities_success',
        userId,
        vendorId,
      });

      return result;
    } catch (error: any) {
      this.logger.error({
        event: 'getvendorcapabilities_failed',
        userId,
        vendorId,
        error: error.message,
      });
      throw error;
    }
  }

  async updatevendorcapabilities(
    request: LambdaRequest,
  ): Promise<VendorCapabilities> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);
    const body = request.body as UpdateVendorCapabilitiesRequest;

    this.logger.info({
      event: 'updatevendorcapabilities_start',
      userId,
      vendorId,
    });

    try {
      await this.requireAccessibleVendor(request, vendorId);
      const existing = await this.repository.getCapabilities(vendorId);
      const ddbItem = CapabilitiesMapper.toDdbItem(body, vendorId, {
        createdAt: existing?.createdAt,
      });

      try {
        await this.repository.putCapabilities(ddbItem);
      } catch (err) {
        if (isConditionalWriteConflictAtIndex(err, 0)) {
          throw new NotFoundError('Vendor not found');
        }
        if (err instanceof ConditionalWriteConflictError) {
          throw new NotFoundError('Vendor not found');
        }
        throw err;
      }

      this.logger.info({
        event: 'updatevendorcapabilities_success',
        userId,
        vendorId,
      });

      return CapabilitiesMapper.toDomain(ddbItem);
    } catch (error: any) {
      this.logger.error({
        event: 'updatevendorcapabilities_failed',
        userId,
        vendorId,
        error: error.message,
      });
      throw error;
    }
  }
}

let service: CapabilitiesService;

export function getCapabilitiesService() {
  if (!service) {
    service = new CapabilitiesService();
  }

  return service;
}
