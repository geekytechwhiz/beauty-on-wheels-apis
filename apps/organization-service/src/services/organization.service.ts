import { OrganizationRepository } from '../repositories/organization.repository';
import { createLogger, serializeError, createPerformanceTimer, createChildLogger } from '@api-hub/logger';
import { Organization, OrganizationMetadata, OrganizationFile, OrganizationUser, OrganizationDevice } from '../models';
import { OrganizationNotFoundError } from '../utils/errors';
import { publishEvent } from '../events/event.publisher';
import { randomUUID } from 'crypto';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

export class OrganizationService {
  private repository: OrganizationRepository;

  constructor() {
    this.repository = new OrganizationRepository();
  }

  async createOrganization(data: Partial<Organization>, correlationId?: string): Promise<Organization> {
    const timer = createPerformanceTimer(baseLogger, 'createOrganization', correlationId);
    const organizationId = data.organizationId || randomUUID();
    const logger = createChildLogger(baseLogger, { correlationId, organizationId });
    logger.info({ event: 'service_createOrganization_start' });

    try {
      const now = Date.now();
      const status = data.status || 'PENDING';
      const traceId = data.traceId || randomUUID();
      const adminDetails = undefined;
      const organizationInfo =
        data.organizationInfo && typeof data.organizationInfo === 'object'
          ? {
              ...(data.organizationInfo as Record<string, unknown>),
              createdDate: now,
              modifiedDate: now,
              organizationID: organizationId,
            }
          : data.organizationInfo;
      const searchFields =
        data.searchFields && typeof data.searchFields === 'object'
          ? data.searchFields
          : {
              name: (data.name || '').toLowerCase(),
              city: (data.city || '').toLowerCase(),
              country: (data.country || '').toLowerCase(),
              countryCode: (data.countryCode || '').toLowerCase(),
              state: (data.state || '').toLowerCase(),
              organizationType: data.organizationType?.toLowerCase(),
            };

      const organization: Organization = {
        pk: `ORG#${organizationId}`,
        sk: 'ORG_DETAILS',
        gsi1pk: 'ORG_LIST',
        gsi1sk: `ORG#${organizationId}`,
        organizationId,
        createdAt: now,
        createdBy: data.createdBy,
        modifiedBy: data.modifiedBy || 'ROOT_ADMIN',
        traceId,
        parentOrgId: data.parentOrgId,
        name: data.name || '',
        email: data.email,
        phone: data.phone,
        address: data.address,
        city: data.city,
        state: data.state,
        country: data.country,
        countryCode: data.countryCode,
        postalCode: data.postalCode,
        status,
        createdDate: now,
        modifiedDate: now,
        deleted: false,
        itemType: 'ORG_DETAILS',
        lsi_createdAt: now,
        lsi_entityType: 'ORG_DETAILS',
        lsi_organizationType: data.organizationType,
        lsi_status: status,
        organizationType: data.organizationType,
        organizationSize: data.organizationSize,
        noOfBranches: data.noOfBranches,
        phoneCode: data.phoneCode,
        phoneNumber: data.phoneNumber,
        hospitalImage: data.hospitalImage,
        googleMapsLink: data.googleMapsLink,
        hospitalBio: data.hospitalBio,
        licenseNumber: data.licenseNumber,
        scheduleConf: data.scheduleConf,
        defaultSetting: data.defaultSetting,
        goals: data.goals,
        thresholds: data.thresholds,
        workingHours: data.workingHours,
        specialization: data.specialization,
        certifications: data.certifications,
        servicesOffered: data.servicesOffered,
        appointmentType: data.appointmentType,
        facilityType: data.facilityType,
        equipmentAvailable: data.equipmentAvailable,
        emergencySupport: data.emergencySupport,
        industryType: data.industryType,
        wellnessPrograms: data.wellnessPrograms,
        onsiteFacilities: data.onsiteFacilities,
        employeeCoverage: data.employeeCoverage,
        insurancePartnerships: data.insurancePartnerships,
        remoteWellnessSupport: data.remoteWellnessSupport,
        corporateDiscounts: data.corporateDiscounts,
        adminDetails,
        modules: data.modules,
        devices: data.devices,
        supportedVitals: data.supportedVitals,
        organizationInfo,
        searchFields,
        website: data.website,
        taxId: data.taxId,
        registrationNumber: data.registrationNumber,
        description: data.description,
        industry: data.industry,
        size: data.size,
      };

      await this.repository.createOrganization(organization);

      await publishEvent(
        {
          eventId: randomUUID(),
          eventType: 'OrganizationCreated.v1',
          occurredAt: new Date().toISOString(),
          source: 'organization-service',
          correlationId,
          data: {
            organizationId,
            name: organization.name,
            email: organization.email,
            status: organization.status,
            createdDate: organization.createdDate,
          },
        },
        correlationId,
      );

      logger.info({ event: 'service_createOrganization_success' });
      timer.end();
      return organization;
    } catch (err) {
      logger.error({ event: 'service_createOrganization_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async getOrganization(organizationId: string): Promise<Organization> {
    const timer = createPerformanceTimer(baseLogger, 'getOrganization');
    const logger = createChildLogger(baseLogger, { organizationId });
    logger.info({ event: 'service_getOrganization_start' });

    try {
      const organization = await this.repository.getOrganization(organizationId);
      if (!organization) {
        throw new OrganizationNotFoundError(organizationId);
      }

      logger.info({ event: 'service_getOrganization_success' });
      timer.end();
      return organization;
    } catch (err) {
      logger.error({ event: 'service_getOrganization_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async updateOrganization(
    organizationId: string,
    updates: Partial<Organization>,
    correlationId?: string,
  ): Promise<Organization> {
    const timer = createPerformanceTimer(baseLogger, 'updateOrganization', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, organizationId });
    logger.info({ event: 'service_updateOrganization_start' });

    try {
      const existing = await this.repository.getOrganization(organizationId);
      if (!existing) {
        throw new OrganizationNotFoundError(organizationId);
      }

      await this.repository.updateOrganization(organizationId, updates);
      const updated = await this.repository.getOrganization(organizationId);
      if (!updated) {
        throw new OrganizationNotFoundError(organizationId);
      }

      const updatedFields: Record<string, unknown> = {};
      if (updates.name !== undefined) updatedFields.name = updates.name;
      if (updates.email !== undefined) updatedFields.email = updates.email;
      if (updates.phone !== undefined) updatedFields.phone = updates.phone;
      if (updates.address !== undefined) updatedFields.address = updates.address;
      if (updates.city !== undefined) updatedFields.city = updates.city;
      if (updates.state !== undefined) updatedFields.state = updates.state;
      if (updates.country !== undefined) updatedFields.country = updates.country;
      if (updates.postalCode !== undefined) updatedFields.postalCode = updates.postalCode;
      if (updates.status !== undefined) updatedFields.status = updates.status;
      if (updates.website !== undefined) updatedFields.website = updates.website;
      if (updates.taxId !== undefined) updatedFields.taxId = updates.taxId;
      if (updates.registrationNumber !== undefined) updatedFields.registrationNumber = updates.registrationNumber;
      if (updates.description !== undefined) updatedFields.description = updates.description;
      if (updates.industry !== undefined) updatedFields.industry = updates.industry;
      if (updates.size !== undefined) updatedFields.size = updates.size;

      await publishEvent(
        {
          eventId: randomUUID(),
          eventType: 'OrganizationUpdated.v1',
          occurredAt: new Date().toISOString(),
          source: 'organization-service',
          correlationId,
          data: {
            organizationId,
            updatedFields,
            modifiedDate: updated.modifiedDate,
          },
        },
        correlationId,
      );

      logger.info({ event: 'service_updateOrganization_success' });
      timer.end();
      return updated;
    } catch (err) {
      logger.error({ event: 'service_updateOrganization_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async deleteOrganization(organizationId: string, correlationId?: string): Promise<void> {
    const timer = createPerformanceTimer(baseLogger, 'deleteOrganization', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, organizationId });
    logger.info({ event: 'service_deleteOrganization_start' });

    try {
      const existing = await this.repository.getOrganization(organizationId);
      if (!existing) {
        throw new OrganizationNotFoundError(organizationId);
      }

      await this.repository.deleteOrganization(organizationId);

      await publishEvent(
        {
          eventId: randomUUID(),
          eventType: 'OrganizationDeleted.v1',
          occurredAt: new Date().toISOString(),
          source: 'organization-service',
          correlationId,
          data: {
            organizationId,
            deletedAt: Date.now(),
          },
        },
        correlationId,
      );

      logger.info({ event: 'service_deleteOrganization_success' });
      timer.end();
    } catch (err) {
      logger.error({ event: 'service_deleteOrganization_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async assignUserToOrganization(organizationId: string, userId: string, role?: string, correlationId?: string): Promise<void> {
    const timer = createPerformanceTimer(baseLogger, 'assignUserToOrganization', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, organizationId, userId });
    logger.info({ event: 'service_assignUserToOrg_start' });

    try {
      const existing = await this.repository.getOrganization(organizationId);
      if (!existing) {
        throw new OrganizationNotFoundError(organizationId);
      }

      await this.repository.assignUserToOrganization(organizationId, userId, role);

      await publishEvent(
        {
          eventId: randomUUID(),
          eventType: 'OrganizationUserAssigned.v1',
          occurredAt: new Date().toISOString(),
          source: 'organization-service',
          correlationId,
          data: {
            organizationId,
            userId,
            assignedAt: new Date().toISOString(),
            role,
          },
        },
        correlationId,
      );

      logger.info({ event: 'service_assignUserToOrg_success' });
      timer.end();
    } catch (err) {
      logger.error({ event: 'service_assignUserToOrg_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async removeUserFromOrganization(organizationId: string, userId: string, correlationId?: string): Promise<void> {
    const timer = createPerformanceTimer(baseLogger, 'removeUserFromOrganization', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, organizationId, userId });
    logger.info({ event: 'service_removeUserFromOrg_start' });

    try {
      const existing = await this.repository.getOrganization(organizationId);
      if (!existing) {
        throw new OrganizationNotFoundError(organizationId);
      }

      await this.repository.removeUserFromOrganization(organizationId, userId);

      await publishEvent(
        {
          eventId: randomUUID(),
          eventType: 'OrganizationUserRemoved.v1',
          occurredAt: new Date().toISOString(),
          source: 'organization-service',
          correlationId,
          data: {
            organizationId,
            userId,
            removedAt: new Date().toISOString(),
          },
        },
        correlationId,
      );

      logger.info({ event: 'service_removeUserFromOrg_success' });
      timer.end();
    } catch (err) {
      logger.error({ event: 'service_removeUserFromOrg_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async listOrganizationUsers(organizationId: string): Promise<OrganizationUser[]> {
    const timer = createPerformanceTimer(baseLogger, 'listOrganizationUsers');
    const logger = createChildLogger(baseLogger, { organizationId });
    logger.info({ event: 'service_listOrganizationUsers_start' });

    try {
      const existing = await this.repository.getOrganization(organizationId);
      if (!existing) {
        throw new OrganizationNotFoundError(organizationId);
      }

      const users = await this.repository.listOrganizationUsers(organizationId);
      logger.info({ event: 'service_listOrganizationUsers_success', count: users.length });
      timer.end();
      return users;
    } catch (err) {
      logger.error({ event: 'service_listOrganizationUsers_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async assignDeviceToOrganization(organizationId: string, deviceId: string, correlationId?: string): Promise<void> {
    const timer = createPerformanceTimer(baseLogger, 'assignDeviceToOrganization', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, organizationId, deviceId });
    logger.info({ event: 'service_assignDeviceToOrg_start' });

    try {
      const existing = await this.repository.getOrganization(organizationId);
      if (!existing) {
        throw new OrganizationNotFoundError(organizationId);
      }

      await this.repository.assignDeviceToOrganization(organizationId, deviceId);

      await publishEvent(
        {
          eventId: randomUUID(),
          eventType: 'OrganizationDeviceAssigned.v1',
          occurredAt: new Date().toISOString(),
          source: 'organization-service',
          correlationId,
          data: {
            organizationId,
            deviceId,
            assignedAt: new Date().toISOString(),
          },
        },
        correlationId,
      );

      logger.info({ event: 'service_assignDeviceToOrg_success' });
      timer.end();
    } catch (err) {
      logger.error({ event: 'service_assignDeviceToOrg_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async removeDeviceFromOrganization(organizationId: string, deviceId: string, correlationId?: string): Promise<void> {
    const timer = createPerformanceTimer(baseLogger, 'removeDeviceFromOrganization', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, organizationId, deviceId });
    logger.info({ event: 'service_removeDeviceFromOrg_start' });

    try {
      const existing = await this.repository.getOrganization(organizationId);
      if (!existing) {
        throw new OrganizationNotFoundError(organizationId);
      }

      await this.repository.removeDeviceFromOrganization(organizationId, deviceId);

      await publishEvent(
        {
          eventId: randomUUID(),
          eventType: 'OrganizationDeviceRemoved.v1',
          occurredAt: new Date().toISOString(),
          source: 'organization-service',
          correlationId,
          data: {
            organizationId,
            deviceId,
            removedAt: new Date().toISOString(),
          },
        },
        correlationId,
      );

      logger.info({ event: 'service_removeDeviceFromOrg_success' });
      timer.end();
    } catch (err) {
      logger.error({ event: 'service_removeDeviceFromOrg_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async listOrganizationDevices(organizationId: string): Promise<OrganizationDevice[]> {
    const timer = createPerformanceTimer(baseLogger, 'listOrganizationDevices');
    const logger = createChildLogger(baseLogger, { organizationId });
    logger.info({ event: 'service_listOrganizationDevices_start' });

    try {
      const existing = await this.repository.getOrganization(organizationId);
      if (!existing) {
        throw new OrganizationNotFoundError(organizationId);
      }

      const devices = await this.repository.listOrganizationDevices(organizationId);
      logger.info({ event: 'service_listOrganizationDevices_success', count: devices.length });
      timer.end();
      return devices;
    } catch (err) {
      logger.error({ event: 'service_listOrganizationDevices_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async updateOrganizationMetadata(
    organizationId: string,
    metadata: Record<string, unknown>,
    correlationId?: string,
    updatedBy?: string,
    version?: number,
  ): Promise<OrganizationMetadata> {
    const timer = createPerformanceTimer(baseLogger, 'updateOrganizationMetadata', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, organizationId });
    logger.info({ event: 'service_updateOrganizationMetadata_start' });

    try {
      const existing = await this.repository.getOrganization(organizationId);
      if (!existing) {
        throw new OrganizationNotFoundError(organizationId);
      }

      await this.repository.updateOrganizationMetadata(organizationId, metadata, updatedBy, version);
      const updated = await this.repository.getOrganizationMetadata(organizationId);
      if (!updated) {
        throw new OrganizationNotFoundError(organizationId);
      }

      await publishEvent(
        {
          eventId: randomUUID(),
          eventType: 'OrganizationMetadataUpdated.v1',
          occurredAt: new Date().toISOString(),
          source: 'organization-service',
          correlationId,
          data: {
            organizationId,
            metadata,
            updatedAt: updated.updatedAt,
            ...(updated.updatedBy ? { updatedBy: updated.updatedBy } : {}),
            ...(updated.version !== undefined ? { version: updated.version } : {}),
          },
        },
        correlationId,
      );

      logger.info({ event: 'service_updateOrganizationMetadata_success' });
      timer.end();
      return updated;
    } catch (err) {
      logger.error({ event: 'service_updateOrganizationMetadata_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async listOrganizationFiles(organizationId: string): Promise<OrganizationFile[]> {
    const timer = createPerformanceTimer(baseLogger, 'listOrganizationFiles');
    const logger = createChildLogger(baseLogger, { organizationId });
    logger.info({ event: 'service_listOrganizationFiles_start' });

    try {
      const existing = await this.repository.getOrganization(organizationId);
      if (!existing) {
        throw new OrganizationNotFoundError(organizationId);
      }

      const files = await this.repository.listOrganizationFiles(organizationId);
      logger.info({ event: 'service_listOrganizationFiles_success', count: files.length });
      timer.end();
      return files;
    } catch (err) {
      logger.error({ event: 'service_listOrganizationFiles_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async createOrganizationFile(
    organizationId: string,
    fileId: string,
    fileName: string,
    s3Key: string,
    correlationId?: string,
    fileSize?: number,
    contentType?: string,
    uploadedBy?: string,
    description?: string,
    tags?: string[],
  ): Promise<OrganizationFile> {
    const timer = createPerformanceTimer(baseLogger, 'createOrganizationFile', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, organizationId, fileId });
    logger.info({ event: 'service_createOrganizationFile_start' });

    try {
      const existing = await this.repository.getOrganization(organizationId);
      if (!existing) {
        throw new OrganizationNotFoundError(organizationId);
      }

      const now = new Date().toISOString();
      const organizationFile: OrganizationFile = {
        pk: `ORG#${organizationId}`,
        sk: `ORG_FILE#${fileId}`,
        organizationId,
        fileId,
        fileName,
        s3Key,
        uploadedAt: now,
        itemType: 'ORG_FILE',
        fileSize,
        contentType,
        uploadedBy,
        description,
        tags,
      };

      await this.repository.createOrganizationFile(organizationFile);

      await publishEvent(
        {
          eventId: randomUUID(),
          eventType: 'OrganizationFileUploaded.v1',
          occurredAt: now,
          source: 'organization-service',
          correlationId,
          data: {
            organizationId,
            fileId,
            fileName,
            s3Key,
            uploadedAt: now,
            ...(fileSize !== undefined ? { fileSize } : {}),
            ...(contentType ? { contentType } : {}),
            ...(uploadedBy ? { uploadedBy } : {}),
            ...(description ? { description } : {}),
            ...(tags ? { tags } : {}),
          },
        },
        correlationId,
      );

      logger.info({ event: 'service_createOrganizationFile_success' });
      timer.end();
      return organizationFile;
    } catch (err) {
      logger.error({ event: 'service_createOrganizationFile_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }
}
