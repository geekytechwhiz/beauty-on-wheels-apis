import { DeviceMappingRepository, DeviceUserMapping, DeviceOrgMapping, DeviceMetadata, DeviceFileReference } from '../repositories/deviceMappingRepository';
import { createLogger, serializeError, createChildLogger } from '@api-hub/observability';
import { DeviceNotFoundError } from '../utils/errors';
import * as crypto from 'crypto';

const baseLogger = createLogger({ service: 'device-mapping-service' });

export class DeviceMappingService {
  private deviceMappingRepository: DeviceMappingRepository;

  constructor() {
    this.deviceMappingRepository = new DeviceMappingRepository();
  }

  /**
   * Assign device to user
   */
  async assignDeviceToUser(deviceId: string, userId: string, correlationId?: string): Promise<DeviceUserMapping> {
    const logger = createChildLogger(baseLogger, { correlationId, deviceId, userId });
    logger.info({ event: 'service_assignDeviceToUser_start' });

    try {
      // Check if device exists
      const deviceExists = await this.deviceMappingRepository.deviceExists(deviceId);
      if (!deviceExists) {
        throw new DeviceNotFoundError(deviceId);
      }

      // Assign device to user (idempotent - will return existing if already mapped)
      const mapping = await this.deviceMappingRepository.assignDeviceToUser(deviceId, userId);
      logger.info({ event: 'device_assigned_to_user', deviceId, userId });
      return mapping;
    } catch (err) {
      logger.error({ event: 'service_assignDeviceToUser_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Remove device from user
   */
  async removeDeviceFromUser(deviceId: string, userId: string, correlationId?: string): Promise<void> {
    const logger = createChildLogger(baseLogger, { correlationId, deviceId, userId });
    logger.info({ event: 'service_removeDeviceFromUser_start' });

    try {
      await this.deviceMappingRepository.removeDeviceFromUser(deviceId, userId);
      logger.info({ event: 'device_removed_from_user', deviceId, userId });
    } catch (err) {
      logger.error({ event: 'service_removeDeviceFromUser_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * List users mapped to device
   */
  async listDeviceUsers(deviceId: string, correlationId?: string): Promise<DeviceUserMapping[]> {
    const logger = createChildLogger(baseLogger, { correlationId, deviceId });
    logger.info({ event: 'service_listDeviceUsers_start' });

    try {
      const mappings = await this.deviceMappingRepository.listDeviceUsers(deviceId);
      logger.info({ event: 'device_users_listed', deviceId, count: mappings.length });
      return mappings;
    } catch (err) {
      logger.error({ event: 'service_listDeviceUsers_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Assign device to organization
   */
  async assignDeviceToOrganization(deviceId: string, organizationId: string, correlationId?: string): Promise<DeviceOrgMapping> {
    const logger = createChildLogger(baseLogger, { correlationId, deviceId, organizationId });
    logger.info({ event: 'service_assignDeviceToOrganization_start' });

    try {
      // Check if device exists
      const deviceExists = await this.deviceMappingRepository.deviceExists(deviceId);
      if (!deviceExists) {
        throw new DeviceNotFoundError(deviceId);
      }

      // Assign device to organization (idempotent)
      const mapping = await this.deviceMappingRepository.assignDeviceToOrganization(deviceId, organizationId);
      logger.info({ event: 'device_assigned_to_organization', deviceId, organizationId });
      return mapping;
    } catch (err) {
      logger.error({ event: 'service_assignDeviceToOrganization_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Remove device from organization
   */
  async removeDeviceFromOrganization(deviceId: string, organizationId: string, correlationId?: string): Promise<void> {
    const logger = createChildLogger(baseLogger, { correlationId, deviceId, organizationId });
    logger.info({ event: 'service_removeDeviceFromOrganization_start' });

    try {
      await this.deviceMappingRepository.removeDeviceFromOrganization(deviceId, organizationId);
      logger.info({ event: 'device_removed_from_organization', deviceId, organizationId });
    } catch (err) {
      logger.error({ event: 'service_removeDeviceFromOrganization_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * List organizations mapped to device
   */
  async listDeviceOrganizations(deviceId: string, correlationId?: string): Promise<DeviceOrgMapping[]> {
    const logger = createChildLogger(baseLogger, { correlationId, deviceId });
    logger.info({ event: 'service_listDeviceOrganizations_start' });

    try {
      const mappings = await this.deviceMappingRepository.listDeviceOrganizations(deviceId);
      logger.info({ event: 'device_organizations_listed', deviceId, count: mappings.length });
      return mappings;
    } catch (err) {
      logger.error({ event: 'service_listDeviceOrganizations_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Create or update device metadata
   */
  async upsertDeviceMetadata(deviceId: string, metadata: Record<string, unknown>, correlationId?: string): Promise<DeviceMetadata> {
    const logger = createChildLogger(baseLogger, { correlationId, deviceId });
    logger.info({ event: 'service_upsertDeviceMetadata_start' });

    try {
      // Check if device exists
      const deviceExists = await this.deviceMappingRepository.deviceExists(deviceId);
      if (!deviceExists) {
        throw new DeviceNotFoundError(deviceId);
      }

      const result = await this.deviceMappingRepository.upsertDeviceMetadata(deviceId, metadata);
      logger.info({ event: 'device_metadata_upserted', deviceId });
      return result;
    } catch (err) {
      logger.error({ event: 'service_upsertDeviceMetadata_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Create device file reference
   */
  async createDeviceFileReference(
    deviceId: string,
    fileName: string,
    fileUrl: string,
    fileSize?: number,
    mimeType?: string,
    correlationId?: string,
  ): Promise<DeviceFileReference> {
    const logger = createChildLogger(baseLogger, { correlationId, deviceId });
    logger.info({ event: 'service_createDeviceFileReference_start' });

    try {
      // Check if device exists
      const deviceExists = await this.deviceMappingRepository.deviceExists(deviceId);
      if (!deviceExists) {
        throw new DeviceNotFoundError(deviceId);
      }

      // Generate fileId
      const fileId = crypto.randomUUID();

      const result = await this.deviceMappingRepository.createDeviceFileReference(
        deviceId,
        fileId,
        fileName,
        fileUrl,
        fileSize,
        mimeType,
      );
      logger.info({ event: 'device_file_reference_created', deviceId, fileId });
      return result;
    } catch (err) {
      logger.error({ event: 'service_createDeviceFileReference_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * List device files
   */
  async listDeviceFiles(deviceId: string, correlationId?: string): Promise<DeviceFileReference[]> {
    const logger = createChildLogger(baseLogger, { correlationId, deviceId });
    logger.info({ event: 'service_listDeviceFiles_start' });

    try {
      const files = await this.deviceMappingRepository.listDeviceFiles(deviceId);
      logger.info({ event: 'device_files_listed', deviceId, count: files.length });
      return files;
    } catch (err) {
      logger.error({ event: 'service_listDeviceFiles_error', err: serializeError(err) });
      throw err;
    }
  }
}
