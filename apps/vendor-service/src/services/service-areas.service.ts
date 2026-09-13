import { randomUUID } from 'crypto';
import { LambdaRequest } from '@api-hub/utils';
import {
  ConflictError,
  ConditionalWriteConflictError,
  NotFoundError,
  isConditionalWriteConflictAtIndex,
} from '@api-hub/utils';
import { createLogger, createChildLogger } from '@api-hub/observability';

import {
  ServiceAreasRepository,
  getServiceAreasRepository,
} from '../repositories/service-areas.repository';
import {
  VendorsRepository,
  getVendorsRepository,
} from '../repositories/vendors.repository';
import { ServiceAreasMapper } from '../mappers/service-areas.mapper';
import {
  CreateServiceAreaRequest,
  ServiceArea,
  UpdateServiceAreaRequest,
} from '../types/api-types';
import {
  assertVendorAccess,
  getAuthenticatedUserId,
  getPathParam,
  getVendorId,
} from '../utils/helpers';

const baseLogger = createLogger({
  service: 'service-areas-service',
  redactPII: true,
});

export class ServiceAreasService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'ServiceAreasService',
  });

  constructor(
    private readonly repository: ServiceAreasRepository = getServiceAreasRepository(),
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

  async listvendorserviceareas(
    request: LambdaRequest,
  ): Promise<{ data: ServiceArea[] }> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);

    this.logger.info({
      event: 'listvendorserviceareas_start',
      userId,
      vendorId,
    });

    try {
      await this.requireAccessibleVendor(request, vendorId);
      const items = await this.repository.listServiceAreas(vendorId);
      const data = items.map((item) => ServiceAreasMapper.toDomain(item));

      this.logger.info({
        event: 'listvendorserviceareas_success',
        userId,
        vendorId,
        count: data.length,
      });

      return { data };
    } catch (error: any) {
      this.logger.error({
        event: 'listvendorserviceareas_failed',
        userId,
        vendorId,
        error: error.message,
      });
      throw error;
    }
  }

  async addvendorservicearea(request: LambdaRequest): Promise<ServiceArea> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);
    const body = request.body as CreateServiceAreaRequest;

    this.logger.info({
      event: 'addvendorservicearea_start',
      userId,
      vendorId,
    });

    try {
      await this.requireAccessibleVendor(request, vendorId);

      const serviceAreaId = randomUUID();
      const ddbItem = ServiceAreasMapper.toDdbItem(body, vendorId, serviceAreaId);

      try {
        await this.repository.createServiceArea(ddbItem);
      } catch (err) {
        if (isConditionalWriteConflictAtIndex(err, 0)) {
          throw new NotFoundError('Vendor not found');
        }
        if (err instanceof ConditionalWriteConflictError) {
          throw new ConflictError('Service area already exists');
        }
        throw err;
      }

      this.logger.info({
        event: 'addvendorservicearea_success',
        userId,
        vendorId,
        serviceAreaId,
      });

      return ServiceAreasMapper.toDomain(ddbItem);
    } catch (error: any) {
      this.logger.error({
        event: 'addvendorservicearea_failed',
        userId,
        vendorId,
        error: error.message,
      });
      throw error;
    }
  }

  async getvendorservicearea(request: LambdaRequest): Promise<ServiceArea> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);
    const serviceAreaId = getPathParam(request, 'serviceAreaId');

    this.logger.info({
      event: 'getvendorservicearea_start',
      userId,
      vendorId,
      serviceAreaId,
    });

    try {
      await this.requireAccessibleVendor(request, vendorId);
      const item = await this.repository.getServiceArea(vendorId, serviceAreaId);
      if (!item) {
        throw new NotFoundError('Service area not found');
      }

      this.logger.info({
        event: 'getvendorservicearea_success',
        userId,
        vendorId,
        serviceAreaId,
      });

      return ServiceAreasMapper.toDomain(item);
    } catch (error: any) {
      this.logger.error({
        event: 'getvendorservicearea_failed',
        userId,
        vendorId,
        serviceAreaId,
        error: error.message,
      });
      throw error;
    }
  }

  async updatevendorservicearea(request: LambdaRequest): Promise<ServiceArea> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);
    const serviceAreaId = getPathParam(request, 'serviceAreaId');
    const body = request.body as UpdateServiceAreaRequest;

    this.logger.info({
      event: 'updatevendorservicearea_start',
      userId,
      vendorId,
      serviceAreaId,
    });

    try {
      await this.requireAccessibleVendor(request, vendorId);
      const existing = await this.repository.getServiceArea(
        vendorId,
        serviceAreaId,
      );
      if (!existing) {
        throw new NotFoundError('Service area not found');
      }

      const updated = ServiceAreasMapper.applyUpdate(existing, body);

      try {
        await this.repository.updateServiceArea(updated);
      } catch (err) {
        if (err instanceof ConditionalWriteConflictError) {
          throw new ConflictError('Service area update conflict');
        }
        throw err;
      }

      this.logger.info({
        event: 'updatevendorservicearea_success',
        userId,
        vendorId,
        serviceAreaId,
      });

      return ServiceAreasMapper.toDomain(updated);
    } catch (error: any) {
      this.logger.error({
        event: 'updatevendorservicearea_failed',
        userId,
        vendorId,
        serviceAreaId,
        error: error.message,
      });
      throw error;
    }
  }

  async deletevendorservicearea(request: LambdaRequest): Promise<void> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);
    const serviceAreaId = getPathParam(request, 'serviceAreaId');

    this.logger.info({
      event: 'deletevendorservicearea_start',
      userId,
      vendorId,
      serviceAreaId,
    });

    try {
      await this.requireAccessibleVendor(request, vendorId);
      const existing = await this.repository.getServiceArea(
        vendorId,
        serviceAreaId,
      );
      if (!existing) {
        throw new NotFoundError('Service area not found');
      }

      try {
        await this.repository.deleteServiceArea(vendorId, serviceAreaId);
      } catch (err) {
        if (err instanceof ConditionalWriteConflictError) {
          throw new NotFoundError('Service area not found');
        }
        throw err;
      }

      this.logger.info({
        event: 'deletevendorservicearea_success',
        userId,
        vendorId,
        serviceAreaId,
      });
    } catch (error: any) {
      this.logger.error({
        event: 'deletevendorservicearea_failed',
        userId,
        vendorId,
        serviceAreaId,
        error: error.message,
      });
      throw error;
    }
  }
}

let service: ServiceAreasService;

export function getServiceAreasService() {
  if (!service) {
    service = new ServiceAreasService();
  }

  return service;
}
