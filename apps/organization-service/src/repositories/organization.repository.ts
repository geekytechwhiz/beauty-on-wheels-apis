import { GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '@api-hub/utils';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { Organization, OrganizationMetadata, OrganizationFile, OrganizationUser, OrganizationDevice } from '../models';
import { OrganizationNotFoundError, OrganizationAlreadyExistsError } from '../utils/errors';
import {
  organizationPk,
  organizationDetailsSk,
  organizationUserSk,
  organizationDeviceSk,
  organizationMetadataSk,
  organizationFileSk,
} from '../utils/helpers';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

const ORGANIZATION_TABLE_NAME = process.env.ORGANIZATION_TABLE || '';

type OrganizationDBItem = Organization & {
  pk: string;
  sk: string;
};

export class OrganizationRepository {
  async createOrganization(organization: Organization): Promise<void> {
    const item: OrganizationDBItem = {
      ...organization,
      pk: organizationPk(organization.organizationId),
      sk: organizationDetailsSk(),
    };
    try {
      await ddbDocClient.send(
        new PutCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        }),
      );
      const logger = createChildLogger(baseLogger, { organizationId: organization.organizationId });
      logger.info({ event: 'organization_created', message: 'Organization created' });
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      const logger = createChildLogger(baseLogger, { organizationId: organization.organizationId });
      if (code === 'ConditionalCheckFailedException') {
        throw new OrganizationAlreadyExistsError(organization.organizationId);
      }
      logger.error({ event: 'organization_create_error', err: serializeError(err), message: 'Failed to create organization' });
      throw err;
    }
  }

  async getOrganization(organizationId: string): Promise<Organization | null> {
    try {
      const result = await ddbDocClient.send(
        new GetCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Key: {
            pk: organizationPk(organizationId),
            sk: organizationDetailsSk(),
          },
        }),
      );

      if (!result.Item || result.Item.deleted === true) {
        return null;
      }

      return result.Item as Organization;
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.error({ event: 'organization_get_error', err: serializeError(err), message: 'Failed to get organization' });
      throw err;
    }
  }

  async updateOrganization(organizationId: string, updates: Partial<Organization>): Promise<void> {
    const now = Date.now();
    const updateParts: string[] = ['modifiedDate = :modifiedDate'];
    const exprNames: Record<string, string> = {};
    const exprValues: Record<string, unknown> = {
      ':modifiedDate': now,
    };

    if (updates.name !== undefined) {
      updateParts.push('#name = :name');
      exprNames['#name'] = 'name';
      exprValues[':name'] = updates.name;
    }

    if (updates.email !== undefined) {
      updateParts.push('email = :email');
      exprValues[':email'] = updates.email;
    }

    if (updates.phone !== undefined) {
      updateParts.push('phone = :phone');
      exprValues[':phone'] = updates.phone;
    }

    if (updates.address !== undefined) {
      updateParts.push('address = :address');
      exprValues[':address'] = updates.address;
    }

    if (updates.city !== undefined) {
      updateParts.push('city = :city');
      exprValues[':city'] = updates.city;
    }

    if (updates.state !== undefined) {
      updateParts.push('#state = :state');
      exprNames['#state'] = 'state';
      exprValues[':state'] = updates.state;
    }

    if (updates.country !== undefined) {
      updateParts.push('country = :country');
      exprValues[':country'] = updates.country;
    }

    if (updates.postalCode !== undefined) {
      updateParts.push('postalCode = :postalCode');
      exprValues[':postalCode'] = updates.postalCode;
    }

    if (updates.status !== undefined) {
      updateParts.push('#status = :status');
      exprNames['#status'] = 'status';
      exprValues[':status'] = updates.status;
    }

    if (updates.organizationType !== undefined) {
      updateParts.push('organizationType = :organizationType');
      exprValues[':organizationType'] = updates.organizationType;
    }

    if (updates.organizationSize !== undefined) {
      updateParts.push('organizationSize = :organizationSize');
      exprValues[':organizationSize'] = updates.organizationSize;
    }

    if (updates.noOfBranches !== undefined) {
      updateParts.push('noOfBranches = :noOfBranches');
      exprValues[':noOfBranches'] = updates.noOfBranches;
    }

    if (updates.phoneCode !== undefined) {
      updateParts.push('phoneCode = :phoneCode');
      exprValues[':phoneCode'] = updates.phoneCode;
    }

    if (updates.phoneNumber !== undefined) {
      updateParts.push('phoneNumber = :phoneNumber');
      exprValues[':phoneNumber'] = updates.phoneNumber;
    }

    if (updates.countryCode !== undefined) {
      updateParts.push('countryCode = :countryCode');
      exprValues[':countryCode'] = updates.countryCode;
    }

    if (updates.hospitalImage !== undefined) {
      updateParts.push('hospitalImage = :hospitalImage');
      exprValues[':hospitalImage'] = updates.hospitalImage;
    }

    if (updates.googleMapsLink !== undefined) {
      updateParts.push('googleMapsLink = :googleMapsLink');
      exprValues[':googleMapsLink'] = updates.googleMapsLink;
    }

    if (updates.hospitalBio !== undefined) {
      updateParts.push('hospitalBio = :hospitalBio');
      exprValues[':hospitalBio'] = updates.hospitalBio;
    }

    if (updates.licenseNumber !== undefined) {
      updateParts.push('licenseNumber = :licenseNumber');
      exprValues[':licenseNumber'] = updates.licenseNumber;
    }

    if (updates.scheduleConf !== undefined) {
      updateParts.push('scheduleConf = :scheduleConf');
      exprValues[':scheduleConf'] = updates.scheduleConf;
    }

    if (updates.defaultSetting !== undefined) {
      updateParts.push('defaultSetting = :defaultSetting');
      exprValues[':defaultSetting'] = updates.defaultSetting;
    }

    if (updates.goals !== undefined) {
      updateParts.push('goals = :goals');
      exprValues[':goals'] = updates.goals;
    }

    if (updates.thresholds !== undefined) {
      updateParts.push('thresholds = :thresholds');
      exprValues[':thresholds'] = updates.thresholds;
    }

    if (updates.workingHours !== undefined) {
      updateParts.push('workingHours = :workingHours');
      exprValues[':workingHours'] = updates.workingHours;
    }

    if (updates.specialization !== undefined) {
      updateParts.push('specialization = :specialization');
      exprValues[':specialization'] = updates.specialization;
    }

    if (updates.certifications !== undefined) {
      updateParts.push('certifications = :certifications');
      exprValues[':certifications'] = updates.certifications;
    }

    if (updates.servicesOffered !== undefined) {
      updateParts.push('servicesOffered = :servicesOffered');
      exprValues[':servicesOffered'] = updates.servicesOffered;
    }

    if (updates.appointmentType !== undefined) {
      updateParts.push('appointmentType = :appointmentType');
      exprValues[':appointmentType'] = updates.appointmentType;
    }

    if (updates.facilityType !== undefined) {
      updateParts.push('facilityType = :facilityType');
      exprValues[':facilityType'] = updates.facilityType;
    }

    if (updates.equipmentAvailable !== undefined) {
      updateParts.push('equipmentAvailable = :equipmentAvailable');
      exprValues[':equipmentAvailable'] = updates.equipmentAvailable;
    }

    if (updates.emergencySupport !== undefined) {
      updateParts.push('emergencySupport = :emergencySupport');
      exprValues[':emergencySupport'] = updates.emergencySupport;
    }

    if (updates.industryType !== undefined) {
      updateParts.push('industryType = :industryType');
      exprValues[':industryType'] = updates.industryType;
    }

    if (updates.wellnessPrograms !== undefined) {
      updateParts.push('wellnessPrograms = :wellnessPrograms');
      exprValues[':wellnessPrograms'] = updates.wellnessPrograms;
    }

    if (updates.onsiteFacilities !== undefined) {
      updateParts.push('onsiteFacilities = :onsiteFacilities');
      exprValues[':onsiteFacilities'] = updates.onsiteFacilities;
    }

    if (updates.employeeCoverage !== undefined) {
      updateParts.push('employeeCoverage = :employeeCoverage');
      exprValues[':employeeCoverage'] = updates.employeeCoverage;
    }

    if (updates.insurancePartnerships !== undefined) {
      updateParts.push('insurancePartnerships = :insurancePartnerships');
      exprValues[':insurancePartnerships'] = updates.insurancePartnerships;
    }

    if (updates.remoteWellnessSupport !== undefined) {
      updateParts.push('remoteWellnessSupport = :remoteWellnessSupport');
      exprValues[':remoteWellnessSupport'] = updates.remoteWellnessSupport;
    }

    if (updates.corporateDiscounts !== undefined) {
      updateParts.push('corporateDiscounts = :corporateDiscounts');
      exprValues[':corporateDiscounts'] = updates.corporateDiscounts;
    }

    if (updates.adminDetails !== undefined) {
      updateParts.push('adminDetails = :adminDetails');
      exprValues[':adminDetails'] = updates.adminDetails;
    }

    if (updates.modules !== undefined) {
      updateParts.push('modules = :modules');
      exprValues[':modules'] = updates.modules;
    }

    if (updates.devices !== undefined) {
      updateParts.push('devices = :devices');
      exprValues[':devices'] = updates.devices;
    }

    if (updates.supportedVitals !== undefined) {
      updateParts.push('supportedVitals = :supportedVitals');
      exprValues[':supportedVitals'] = updates.supportedVitals;
    }

    if (updates.organizationInfo !== undefined) {
      updateParts.push('organizationInfo = :organizationInfo');
      exprValues[':organizationInfo'] = updates.organizationInfo;
    }

    if (updates.searchFields !== undefined) {
      updateParts.push('searchFields = :searchFields');
      exprValues[':searchFields'] = updates.searchFields;
    }

    if (updates.website !== undefined) {
      updateParts.push('website = :website');
      exprValues[':website'] = updates.website;
    }

    if (updates.taxId !== undefined) {
      updateParts.push('taxId = :taxId');
      exprValues[':taxId'] = updates.taxId;
    }

    if (updates.registrationNumber !== undefined) {
      updateParts.push('registrationNumber = :registrationNumber');
      exprValues[':registrationNumber'] = updates.registrationNumber;
    }

    if (updates.description !== undefined) {
      updateParts.push('description = :description');
      exprValues[':description'] = updates.description;
    }

    if (updates.industry !== undefined) {
      updateParts.push('industry = :industry');
      exprValues[':industry'] = updates.industry;
    }

    if (updates.size !== undefined) {
      updateParts.push('#size = :size');
      exprNames['#size'] = 'size';
      exprValues[':size'] = updates.size;
    }

    try {
      await ddbDocClient.send(
        new UpdateCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Key: {
            pk: organizationPk(organizationId),
            sk: organizationDetailsSk(),
          },
          UpdateExpression: `SET ${updateParts.join(', ')}`,
          ExpressionAttributeNames: Object.keys(exprNames).length > 0 ? exprNames : undefined,
          ExpressionAttributeValues: exprValues,
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.info({ event: 'organization_updated', message: 'Organization updated' });
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      const logger = createChildLogger(baseLogger, { organizationId });
      if (code === 'ConditionalCheckFailedException') {
        throw new OrganizationNotFoundError(organizationId);
      }
      logger.error({ event: 'organization_update_error', err: serializeError(err), message: 'Failed to update organization' });
      throw err;
    }
  }

  async deleteOrganization(organizationId: string): Promise<void> {
    const now = Date.now();
    try {
      await ddbDocClient.send(
        new UpdateCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Key: {
            pk: organizationPk(organizationId),
            sk: organizationDetailsSk(),
          },
          UpdateExpression: 'SET deleted = :deleted, modifiedDate = :modifiedDate',
          ExpressionAttributeValues: {
            ':deleted': true,
            ':modifiedDate': now,
          },
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.info({ event: 'organization_deleted', message: 'Organization deleted' });
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      const logger = createChildLogger(baseLogger, { organizationId });
      if (code === 'ConditionalCheckFailedException') {
        throw new OrganizationNotFoundError(organizationId);
      }
      logger.error({ event: 'organization_delete_error', err: serializeError(err), message: 'Failed to delete organization' });
      throw err;
    }
  }

  async assignUserToOrganization(organizationId: string, userId: string, role?: string): Promise<void> {
    const now = new Date().toISOString();
    const item: OrganizationUser = {
      pk: organizationPk(organizationId),
      sk: organizationUserSk(userId),
      organizationId,
      userId,
      assignedAt: now,
      role,
      status: 'ACTIVE',
      itemType: 'ORG_USER',
    };

    try {
      await ddbDocClient.send(
        new PutCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Item: item,
        }),
      );
      const logger = createChildLogger(baseLogger, { organizationId, userId });
      logger.info({ event: 'organization_user_assigned', message: 'User assigned to organization' });
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId, userId });
      logger.error({
        event: 'organization_user_assign_error',
        err: serializeError(err),
        message: 'Failed to assign user to organization',
      });
      throw err;
    }
  }

  async removeUserFromOrganization(organizationId: string, userId: string): Promise<void> {
    try {
      await ddbDocClient.send(
        new DeleteCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Key: {
            pk: organizationPk(organizationId),
            sk: organizationUserSk(userId),
          },
        }),
      );
      const logger = createChildLogger(baseLogger, { organizationId, userId });
      logger.info({ event: 'organization_user_removed', message: 'User removed from organization' });
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId, userId });
      logger.error({
        event: 'organization_user_remove_error',
        err: serializeError(err),
        message: 'Failed to remove user from organization',
      });
      throw err;
    }
  }

  async listOrganizationUsers(organizationId: string): Promise<OrganizationUser[]> {
    try {
      const result = await ddbDocClient.send(
        new QueryCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': organizationPk(organizationId),
            ':skPrefix': 'ORG_USER#',
          },
        }),
      );

      return (result?.Items ?? []) as OrganizationUser[];
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.error({ event: 'organization_users_list_error', err: serializeError(err), message: 'Failed to list organization users' });
      throw err;
    }
  }

  async assignDeviceToOrganization(organizationId: string, deviceId: string): Promise<void> {
    const now = new Date().toISOString();
    const item: OrganizationDevice = {
      pk: organizationPk(organizationId),
      sk: organizationDeviceSk(deviceId),
      organizationId,
      deviceId,
      assignedAt: now,
      status: 'ACTIVE',
      itemType: 'ORG_DEVICE',
    };

    try {
      await ddbDocClient.send(
        new PutCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Item: item,
        }),
      );
      const logger = createChildLogger(baseLogger, { organizationId, deviceId });
      logger.info({ event: 'organization_device_assigned', message: 'Device assigned to organization' });
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId, deviceId });
      logger.error({
        event: 'organization_device_assign_error',
        err: serializeError(err),
        message: 'Failed to assign device to organization',
      });
      throw err;
    }
  }

  async removeDeviceFromOrganization(organizationId: string, deviceId: string): Promise<void> {
    try {
      await ddbDocClient.send(
        new DeleteCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Key: {
            pk: organizationPk(organizationId),
            sk: organizationDeviceSk(deviceId),
          },
        }),
      );
      const logger = createChildLogger(baseLogger, { organizationId, deviceId });
      logger.info({ event: 'organization_device_removed', message: 'Device removed from organization' });
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId, deviceId });
      logger.error({
        event: 'organization_device_remove_error',
        err: serializeError(err),
        message: 'Failed to remove device from organization',
      });
      throw err;
    }
  }

  async listOrganizationDevices(organizationId: string): Promise<OrganizationDevice[]> {
    try {
      const result = await ddbDocClient.send(
        new QueryCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': organizationPk(organizationId),
            ':skPrefix': 'ORG_DEVICE#',
          },
        }),
      );

      return (result?.Items ?? []) as OrganizationDevice[];
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.error({ event: 'organization_devices_list_error', err: serializeError(err), message: 'Failed to list organization devices' });
      throw err;
    }
  }

  async updateOrganizationMetadata(
    organizationId: string,
    metadata: Record<string, unknown>,
    updatedBy?: string,
    version?: number,
  ): Promise<void> {
    const now = new Date().toISOString();
    const item: OrganizationMetadata = {
      pk: organizationPk(organizationId),
      sk: organizationMetadataSk(),
      organizationId,
      metadata,
      updatedAt: now,
      itemType: 'ORG_METADATA',
      ...(updatedBy ? { updatedBy } : {}),
      ...(version !== undefined ? { version } : {}),
    };

    try {
      await ddbDocClient.send(
        new PutCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Item: item,
        }),
      );
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.info({ event: 'organization_metadata_updated', message: 'Organization metadata updated' });
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.error({ event: 'organization_metadata_update_error', err: serializeError(err), message: 'Failed to update organization metadata' });
      throw err;
    }
  }

  async getOrganizationMetadata(organizationId: string): Promise<OrganizationMetadata | null> {
    try {
      const result = await ddbDocClient.send(
        new GetCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Key: {
            pk: organizationPk(organizationId),
            sk: organizationMetadataSk(),
          },
        }),
      );

      if (!result.Item) {
        return null;
      }

      return result.Item as OrganizationMetadata;
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.error({ event: 'organization_metadata_get_error', err: serializeError(err), message: 'Failed to get organization metadata' });
      throw err;
    }
  }

  async createOrganizationFile(organizationFile: OrganizationFile): Promise<void> {
    const item = {
      pk: organizationPk(organizationFile.organizationId),
      sk: organizationFileSk(organizationFile.fileId),
      organizationId: organizationFile.organizationId,
      fileId: organizationFile.fileId,
      fileName: organizationFile.fileName,
      s3Key: organizationFile.s3Key,
      uploadedAt: organizationFile.uploadedAt,
      itemType: 'ORG_FILE',
      ...(organizationFile.fileSize !== undefined ? { fileSize: organizationFile.fileSize } : {}),
      ...(organizationFile.contentType ? { contentType: organizationFile.contentType } : {}),
      ...(organizationFile.uploadedBy ? { uploadedBy: organizationFile.uploadedBy } : {}),
      ...(organizationFile.description ? { description: organizationFile.description } : {}),
      ...(organizationFile.tags ? { tags: organizationFile.tags } : {}),
    };

    try {
      await ddbDocClient.send(
        new PutCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Item: item,
        }),
      );
      const logger = createChildLogger(baseLogger, { organizationId: organizationFile.organizationId, fileId: organizationFile.fileId });
      logger.info({ event: 'organization_file_created', message: 'Organization file created' });
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId: organizationFile.organizationId, fileId: organizationFile.fileId });
      logger.error({
        event: 'organization_file_create_error',
        err: serializeError(err),
        message: 'Failed to create organization file',
      });
      throw err;
    }
  }

  async listOrganizationFiles(organizationId: string): Promise<OrganizationFile[]> {
    try {
      const result = await ddbDocClient.send(
        new QueryCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': organizationPk(organizationId),
            ':skPrefix': 'ORG_FILE#',
          },
        }),
      );

      return (result.Items ?? []) as OrganizationFile[];
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.error({ event: 'organization_files_list_error', err: serializeError(err), message: 'Failed to list organization files' });
      throw err;
    }
  }

}
