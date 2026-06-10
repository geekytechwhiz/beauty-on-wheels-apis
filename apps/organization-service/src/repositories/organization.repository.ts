import { createChildLogger, createLogger, serializeError } from '@api-hub/observability';
import { ddbDocClient } from '@api-hub/utils';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  Organization,
  OrganizationConfigData,
  OrganizationConfigPatch,
  OrganizationFile,
  OrganizationLink,
  OrganizationMetadata,
  OrganizationUpdate,
  OrganizationUser,
  OrgConfigEntity,
  OrgConfigEntityType,
  OrgConfigStatus,
  ORGANIZATION_CONFIG_DATA_KEYS,
} from '../models';
import { OrganizationAlreadyExistsError, OrganizationNotFoundError } from '../utils/errors';
import {
  organizationDetailsSk,
  organizationFileSk,
  organizationLinkPk,
  organizationLinkSk,
  organizationMetadataSk,
  organizationPk,
  organizationUpdatesPk,
  organizationUpdatesSk,
  organizationUserSk
} from '../utils/helpers';
import {
  buildOrgListCursorKey,
  decodeOrgListPaginationKey,
  encodeOrgListPaginationKey,
} from '../utils/organizationList.pagination';
import { DEFAULT_ORG_LIST_LIMIT, MAX_ORG_LIST_LIMIT } from '../utils/organizationList.constants';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

const ORGANIZATION_TABLE_NAME = process.env.ORGANIZATION_TABLE || '';

const ORG_LIST_PROJECTION_ATTRIBUTES = [
  'pk',
  'sk',
  'gsi1pk',
  'gsi1sk',
  'organizationId',
  'name',
  'organizationType',
  'status',
  'country',
  'state',
  'city',
  'address',
  'postalCode',
  'countryCode',
  'phoneCode',
  'phoneNumber',
  'email',
  'hospitalBio',
  'hospitalImage',
  'adminDetails',
  'createdAt',
  'createdDate',
  'organizationInfo',
  'formAlert',
  'parentOrgId',
] as const;

function appendNonDeletedFilter(
  filtersExpr: string[],
  exprNames: Record<string, string>,
  exprValues: Record<string, unknown>,
): void {
  exprNames['#deleted'] = 'deleted';
  exprValues[':deletedTrue'] = true;
  filtersExpr.push('(attribute_not_exists(#deleted) OR #deleted <> :deletedTrue)');
}

function projectionAliasForAttr(attr: string, exprNames: Record<string, string>): string {
  const existing = Object.entries(exprNames).find(([, value]) => value === attr);
  if (existing) {
    return existing[0];
  }
  const alias = `#proj_${attr}`;
  exprNames[alias] = attr;
  return alias;
}

function buildOrgListProjectionExpression(exprNames: Record<string, string>): string {
  return ORG_LIST_PROJECTION_ATTRIBUTES.map((attr) => projectionAliasForAttr(attr, exprNames)).join(', ');
}

export type GetLatestOrganizationConfigOptions = {
  /**
   * When set, DynamoDB returns only these attributes plus `entityType` and `status` (always included
   * so filtering works). When omitted, all attributes are returned.
   */
  project?: readonly (keyof OrgConfigEntity)[];
  /**
   * When true (default), prefer returning the latest ACTIVE config and only fall back to
   * the newest config of any status when no ACTIVE config exists.
   * Set false to always return the newest config regardless of status.
   */
  preferActive?: boolean;
};

type OrganizationDBItem = Organization & {
  pk: string;
  sk: string;
};

export class OrganizationRepository {
  private buildLatestOrgConfigQueryProjection(options?: GetLatestOrganizationConfigOptions): {
    ProjectionExpression?: string;
    projectionExprNames: Record<string, string>;
  } {
    if (options?.project === undefined) {
      return { projectionExprNames: {} };
    }
    const merged = new Set<string>(['entityType', 'status']);
    for (const key of options.project) {
      merged.add(key);
    }
    const projectionExprNames: Record<string, string> = {};
    const tokens: string[] = [];
    for (const attr of merged) {
      if (attr === 'status') {
        tokens.push('#status');
        projectionExprNames['#status'] = 'status';
      } else {
        tokens.push(attr);
      }
    }
    return {
      ProjectionExpression: tokens.join(', '),
      projectionExprNames,
    };
  }

  private sanitizeOrganization(item: Organization): Organization {
    const sanitized = { ...(item as unknown as Record<string, unknown>) };
    delete sanitized.pk;
    delete sanitized.sk;
    Object.keys(sanitized).forEach((key) => {
      if (key.startsWith('gsi') || key.startsWith('lsi')) {
        delete sanitized[key];
      }
    });
    const integ = sanitized.integration;
    if (integ && typeof integ === 'object' && !Array.isArray(integ)) {
      const i = { ...(integ as Record<string, unknown>) };
      if (i.provider == null && i.providerId != null) {
        i.provider = i.providerId;
      }
      delete i.providerId;
      if (i.sourceSystem == null && i.integrationType != null) {
        i.sourceSystem = i.integrationType;
      }
      delete i.integrationType;
      sanitized.integration = i;
    }
    return sanitized as unknown as Organization;
  }

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
        }) as any,
      ) as any;
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
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.info({ event: 'organization_get_start', message: 'Getting organization' });
      logger.info({
        event: 'organization_get_query',
        key: {
          pk: organizationPk(organizationId),
          sk: organizationDetailsSk(),
        },
      });
      const result:any = await ddbDocClient.send(
        new GetCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Key: {
            pk: organizationPk(organizationId),
            sk: organizationDetailsSk(),
          },
        }) as any,
      );
      if (!result.Item || result.Item.deleted === true) {
        return null;
      }
      const item = this.sanitizeOrganization(result.Item as Organization);
      logger.info({ event: 'organization_get_success', message: 'Organization found' });
      return item as unknown as Organization;
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
      updateParts.push('lsi_status = :lsi_status');
      exprValues[':lsi_status'] = updates.status;
    }

    if (updates.organizationType !== undefined) {
      updateParts.push('organizationType = :organizationType');
      exprValues[':organizationType'] = updates.organizationType;
      updateParts.push('lsi_organizationType = :lsi_organizationType');
      exprValues[':lsi_organizationType'] = updates.organizationType;
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

    if (updates.subdomain !== undefined) {
      updateParts.push('subdomain = :subdomain');
      exprValues[':subdomain'] = updates.subdomain;
    }

    if (updates.integration !== undefined) {
      updateParts.push('integration = :integration');
      exprValues[':integration'] = updates.integration;
      const provider = updates.integration?.provider?.toUpperCase();
      const subdomain = updates.subdomain?.toLowerCase();
      if (provider && subdomain) {
        updateParts.push('gsi2pk = :gsi2pk');
        exprValues[':gsi2pk'] = `PROVIDER#${provider}`;
        updateParts.push('gsi2sk = :gsi2sk');
        exprValues[':gsi2sk'] = `LOOKUP#${subdomain}#ORG#${organizationId}`;
      } else if (updates.subdomain === undefined || !updates.subdomain) {
        updateParts.push('gsi2pk = :gsi2pk');
        updateParts.push('gsi2sk = :gsi2sk');
        exprValues[':gsi2pk'] = null;
        exprValues[':gsi2sk'] = null;
      }
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
        }) as any,
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
        }) as any,
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

  async updateOrganizationStatus(
    organizationId: string,
    status: 'ACTIVE' | 'HOLD' | 'DISABLED',
    now: number,
  ): Promise<void> {
    const exprNames: Record<string, string> = {
      '#status': 'status',
      '#modifiedDate': 'modifiedDate',
      '#lsi_status': 'lsi_status',
    };
    const exprValues: Record<string, unknown> = {
      ':status': status,
      ':modifiedDate': now,
      ':lsi_status': status,
    };
    let updateExpression: string;
    if (status === 'HOLD') {
      exprNames['#holdDate'] = 'holdDate';
      exprValues[':holdDate'] = now;
      updateExpression = 'SET #modifiedDate = :modifiedDate, #status = :status, #lsi_status = :lsi_status, #holdDate = :holdDate';
    } else {
      updateExpression = 'SET #modifiedDate = :modifiedDate, #status = :status, #lsi_status = :lsi_status REMOVE holdDate';
    }
    try {
      await ddbDocClient.send(
        new UpdateCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Key: {
            pk: organizationPk(organizationId),
            sk: organizationDetailsSk(),
          },
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: exprNames,
          ExpressionAttributeValues: exprValues,
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }) as any,
      );
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.info({ event: 'organization_status_updated', status });
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      const logger = createChildLogger(baseLogger, { organizationId });
      if (code === 'ConditionalCheckFailedException') {
        throw new OrganizationNotFoundError(organizationId);
      }
      logger.error({ event: 'organization_status_update_error', err: serializeError(err) });
      throw err;
    }
  }

  async getLatestOrganizationConfig(
    organizationId: string,
    options?: GetLatestOrganizationConfigOptions,
  ): Promise<OrgConfigEntity | null> {
    const logger = createChildLogger(baseLogger, { organizationId });

    try {
      const { ProjectionExpression, projectionExprNames } = this.buildLatestOrgConfigQueryProjection(options);
      let lastEvaluatedKey: Record<string, unknown> | undefined;
      let fallback: OrgConfigEntity | null = null;

      const preferActive = options?.preferActive ?? true;
      do {
        const queryParams: Record<string, unknown> = {
          TableName: ORGANIZATION_TABLE_NAME,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
          ExpressionAttributeNames: {
            '#pk': 'pk',
            '#sk': 'sk',
            ...projectionExprNames,
          },
          ExpressionAttributeValues: {
            ':pk': organizationPk(organizationId),
            ':skPrefix': 'CONFIG#v',
          },
          ScanIndexForward: false,
          Limit: 10,
        };

        if (ProjectionExpression) {
          queryParams.ProjectionExpression = ProjectionExpression;
        }

        if (lastEvaluatedKey) {
          queryParams.ExclusiveStartKey = lastEvaluatedKey;
        }

        const response:any = await ddbDocClient.send(new QueryCommand(queryParams as any) as any);

        const items = (response.Items ?? []) as OrgConfigEntity[];

        for (const item of items) {
          if (item.entityType !== OrgConfigEntityType.ORG_CONFIG) continue;

          if (!fallback) fallback = item;

          if (!preferActive || item.status === OrgConfigStatus.ACTIVE) {
            return item;
          }
        }

        lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastEvaluatedKey);

      return fallback;
    } catch (err) {
      logger.error({ event: 'organization_config_get_latest_error', err: serializeError(err) });
      throw err;
    }
  }

  async createOrganizationConfigVersion(
    organizationId: string,
    mergedConfig: Required<OrganizationConfigPatch>,
  ): Promise<OrgConfigEntity> {
    const now = Date.now();
    const latestConfig = await this.getLatestOrganizationConfig(organizationId, {
      project: ['pk', 'sk', 'version', 'status'],
      preferActive: false,
    });
    const nextVersion = (latestConfig?.version ?? 0) + 1;
    const nextItem: OrgConfigEntity = {
      pk: organizationPk(organizationId),
      sk: `CONFIG#v${nextVersion}`,
      entityType: OrgConfigEntityType.ORG_CONFIG,
      orgId: organizationId,
      version: nextVersion,
      supportedCountries: mergedConfig.supportedCountries,
      supportedLanguages: mergedConfig.supportedLanguages,
      supportedStates: mergedConfig.supportedStates,
      supportedCategories: mergedConfig.supportedCategories,
      supportedConditions: mergedConfig.supportedConditions,
      status: OrgConfigStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };

    const transactItems: Array<Record<string, unknown>> = [
      {
        Put: {
          TableName: ORGANIZATION_TABLE_NAME,
          Item: nextItem,
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        },
      },
    ];

    const activeConfigToDeactivate =
      latestConfig?.status === OrgConfigStatus.ACTIVE
        ? latestConfig
        : await this.getLatestOrganizationConfig(organizationId, {
            project: ['pk', 'sk', 'status'],
          });

    if (activeConfigToDeactivate && activeConfigToDeactivate.status === OrgConfigStatus.ACTIVE) {
      transactItems.push({
        Update: {
          TableName: ORGANIZATION_TABLE_NAME,
          Key: {
            pk: activeConfigToDeactivate.pk,
            sk: activeConfigToDeactivate.sk,
          },
          UpdateExpression: 'SET #status = :inactive, #updatedAt = :updatedAt',
          ConditionExpression: '#status = :active',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':inactive': OrgConfigStatus.INACTIVE,
            ':active': OrgConfigStatus.ACTIVE,
            ':updatedAt': now,
          },
        },
      });
    }

    try {
      await ddbDocClient.send(
        new TransactWriteCommand({
          TransactItems: transactItems as any,
        }) as any,
      );
      const logger = createChildLogger(baseLogger, { organizationId, version: nextVersion });
      logger.info({ event: 'organization_config_version_created' });
      return nextItem;
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId, version: nextVersion });
      logger.error({ event: 'organization_config_version_create_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Returns the newest `CONFIG#v{n}` item by numeric `version` (any status), or null.
   * Unlike {@link getLatestOrganizationConfig}, this does not rely on lexicographic SK
   * order, so it stays correct past version 9 (e.g. v10 > v9). Used by the config-save
   * draft flow for version detection and change comparison.
   */
  async getLatestOrganizationConfigVersionItem(organizationId: string): Promise<OrgConfigEntity | null> {
    const logger = createChildLogger(baseLogger, { organizationId });
    try {
      let lastEvaluatedKey: Record<string, unknown> | undefined;
      let latest: OrgConfigEntity | null = null;

      do {
        const queryParams: Record<string, unknown> = {
          TableName: ORGANIZATION_TABLE_NAME,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
          ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
          ExpressionAttributeValues: {
            ':pk': organizationPk(organizationId),
            ':skPrefix': 'CONFIG#v',
          },
        };
        if (lastEvaluatedKey) {
          queryParams.ExclusiveStartKey = lastEvaluatedKey;
        }

        const response: any = await ddbDocClient.send(new QueryCommand(queryParams as any) as any);
        const items = (response.Items ?? []) as OrgConfigEntity[];
        for (const item of items) {
          if (item.entityType !== OrgConfigEntityType.ORG_CONFIG) continue;
          if (latest === null || item.version > latest.version) {
            latest = item;
          }
        }
        lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastEvaluatedKey);

      return latest;
    } catch (err) {
      logger.error({ event: 'organization_config_latest_version_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Saves a new org config version as a draft (`status = draft`). Single Put; does NOT
   * deactivate any previous active/current version (publish handles activation later).
   * `nextVersion` is computed numerically from the latest existing version.
   */
  async createOrganizationConfigDraftVersion(
    organizationId: string,
    config: OrganizationConfigData,
    options: { changeReason?: string; createdBy?: string } = {},
  ): Promise<OrgConfigEntity> {
    const now = Date.now();
    const latestConfig = await this.getLatestOrganizationConfigVersionItem(organizationId);
    const nextVersion = (latestConfig?.version ?? 0) + 1;

    const configData: OrganizationConfigData = {};
    for (const key of ORGANIZATION_CONFIG_DATA_KEYS) {
      const value = config[key];
      if (value !== undefined) {
        (configData as Record<string, unknown>)[key] = value;
      }
    }

    const nextItem: OrgConfigEntity = {
      pk: organizationPk(organizationId),
      sk: `CONFIG#v${nextVersion}`,
      entityType: OrgConfigEntityType.ORG_CONFIG,
      orgId: organizationId,
      version: nextVersion,
      ...configData,
      status: OrgConfigStatus.DRAFT,
      ...(options.changeReason !== undefined ? { changeReason: options.changeReason } : {}),
      ...(options.createdBy !== undefined ? { createdBy: options.createdBy } : {}),
      createdAt: now,
      updatedAt: now,
    };

    try {
      await ddbDocClient.send(
        new PutCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Item: nextItem,
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        }) as any,
      );
      const logger = createChildLogger(baseLogger, { organizationId, version: nextVersion });
      logger.info({ event: 'organization_config_draft_version_created' });
      return nextItem;
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId, version: nextVersion });
      logger.error({ event: 'organization_config_draft_version_create_error', err: serializeError(err) });
      throw err;
    }
  }

  async getOrganizationCounts(): Promise<Array<{ sk: string; count: number }>> {
    const logger = createChildLogger(baseLogger, {});
    try {
      logger.info({ event: 'organization_counts_query_start' });
      
      // Query all organizations using GSI1
      const organizations: Array<{ organizationType?: string; deleted?: boolean }> = [];
      let lastEvaluatedKey: Record<string, any> | undefined;
      
      do {
        const queryParams: any = {
          TableName: ORGANIZATION_TABLE_NAME,
          IndexName: 'GSI1',
          KeyConditionExpression: 'gsi1pk = :gsi1pk',
          ExpressionAttributeValues: {
            ':gsi1pk': 'ORG_LIST',
          },
        };
        
        if (lastEvaluatedKey) {
          queryParams.ExclusiveStartKey = lastEvaluatedKey;
        }
        
        const response:any  = await ddbDocClient.send(new QueryCommand(queryParams) as any);
        
        if (response.Items) {
          organizations.push(...(response.Items as Array<{ organizationType?: string; deleted?: boolean }>));
        }
        
        lastEvaluatedKey = response.LastEvaluatedKey;
      } while (lastEvaluatedKey);
      
      // Filter out deleted organizations
      const activeOrganizations = organizations.filter(org => org.deleted !== true);
      
      logger.info({ 
        event: 'organization_counts_queried', 
        totalOrganizations: organizations.length,
        activeOrganizations: activeOrganizations.length
      });
      
      // Count by organization type
      const countsByType: Record<string, number> = {};
      
      for (const org of activeOrganizations) {
        const orgType = org.organizationType || 'UNKNOWN';
        countsByType[orgType] = (countsByType[orgType] || 0) + 1;
      }
      
      // Convert to array format expected by service
      const result = Object.entries(countsByType).map(([type, count]) => ({
        sk: type,
        count: count,
      }));
      
      logger.info({ 
        event: 'organization_counts_fetched', 
        types: Object.keys(countsByType),
        counts: countsByType
      });
      
      return result;
    } catch (err) {
      logger.error({ event: 'organization_counts_error', err: serializeError(err) });
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
        }) as any,
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
        }) as any,
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

  async createLink(fromOrg: string, toOrg: string, fromOrgType: string, toOrgType: string): Promise<void> {
    const now = Date.now();
    const fromOrgLink: OrganizationLink = {
      pk: organizationLinkPk(fromOrg),
      sk: organizationLinkSk(toOrg),
      sk1: toOrgType.toUpperCase(),
      fromOrg,
      toOrg,
      createdDate: now,
      itemType: 'ORG_LINK',
    };
    const toOrgLink: OrganizationLink = {
      pk: organizationLinkPk(toOrg),
      sk: organizationLinkSk(fromOrg),
      sk1: fromOrgType.toUpperCase(),
      fromOrg,
      toOrg,
      createdDate: now,
      itemType: 'ORG_LINK',
    };
    try {
      await Promise.all([
        ddbDocClient.send(
          new PutCommand({
            TableName: ORGANIZATION_TABLE_NAME,
            Item: fromOrgLink,
          }) as any,
        ),
        ddbDocClient.send(
          new PutCommand({
            TableName: ORGANIZATION_TABLE_NAME,
            Item: toOrgLink,
          }) as any,
        ),
      ]);
      const logger = createChildLogger(baseLogger, { fromOrg, toOrg });
      logger.info({ event: 'organization_link_created', message: 'Organizations linked' });
    } catch (err) {
      const logger = createChildLogger(baseLogger, { fromOrg, toOrg });
      logger.error({ event: 'organization_link_create_error', err: serializeError(err), message: 'Failed to create organization link' });
      throw err;
    }
  }

  async deleteLink(fromOrg: string, toOrg: string): Promise<void> {
    try {
      await Promise.all([
        ddbDocClient.send(
          new DeleteCommand({
            TableName: ORGANIZATION_TABLE_NAME,
            Key: {
              pk: organizationLinkPk(fromOrg),
              sk: organizationLinkSk(toOrg),
            },
          }) as any,
        ),
        ddbDocClient.send(
          new DeleteCommand({
            TableName: ORGANIZATION_TABLE_NAME,
            Key: {
              pk: organizationLinkPk(toOrg),
              sk: organizationLinkSk(fromOrg),
            },
          }) as any,
        ),
      ]);
      const logger = createChildLogger(baseLogger, { fromOrg, toOrg });
      logger.info({ event: 'organization_link_deleted', message: 'Organizations unlinked' });
    } catch (err) {
      const logger = createChildLogger(baseLogger, { fromOrg, toOrg });
      logger.error({ event: 'organization_link_delete_error', err: serializeError(err), message: 'Failed to delete organization link' });
      throw err;
    }
  }

  async listLinkedOrganizationIds(
    organizationId: string,
    options?: { orgType?: string; limit?: number; nextPaginationKey?: string },
  ): Promise<{ items: { linkedOrgId: string; fromOrg: string; sk1?: string }[]; nextPaginationKey?: string | null }> {
    try {
      const pk = organizationLinkPk(organizationId);
      let exclusiveStartKey: Record<string, unknown> | undefined;
      if (options?.nextPaginationKey) {
        const decoded = Buffer.from(options.nextPaginationKey, 'base64').toString();
        exclusiveStartKey = JSON.parse(decoded) as Record<string, unknown>;
      }
      const pageLimit = options?.limit && options.limit > 0 ? Math.min(options.limit, 100) : 100;
      const orgTypeUpper = options?.orgType?.trim() ? options.orgType.toUpperCase() : undefined;

      const params: {
        TableName: string;
        KeyConditionExpression: string;
        ExpressionAttributeNames: Record<string, string>;
        ExpressionAttributeValues: Record<string, unknown>;
        Limit: number;
        ExclusiveStartKey?: Record<string, unknown>;
      } = {
        TableName: ORGANIZATION_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': 'pk' },
        ExpressionAttributeValues: { ':pk': pk },
        Limit: pageLimit,
      };
      if (exclusiveStartKey) {
        params.ExclusiveStartKey = exclusiveStartKey;
      }
      const response:any = await ddbDocClient.send(new QueryCommand(params) as any);
      const rawItems = (response.Items || []) as OrganizationLink[];
      const items: { linkedOrgId: string; fromOrg: string; sk1?: string }[] = [];
      for (const item of rawItems) {
        const linkedOrgId = item.sk?.startsWith('ORG_LINK#') ? item.sk.slice('ORG_LINK#'.length) : item.toOrg;
        if (orgTypeUpper && item.sk1 !== orgTypeUpper) {
          continue;
        }
        items.push({
          linkedOrgId,
          fromOrg: item.fromOrg,
          sk1: item.sk1,
        });
      }
      const lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.info({ event: 'organization_linked_ids_listed', count: items.length });
      return {
        items,
        nextPaginationKey: lastEvaluatedKey ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64') : null,
      };
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.error({ event: 'organization_linked_ids_list_error', err: serializeError(err), message: 'Failed to list linked organization ids' });
      throw err;
    }
  }

  async createOrgUpdate(organizationId: string, updates: string, createdBy: string): Promise<void> {
    const now = Date.now();
    const item: OrganizationUpdate = {
      pk: organizationUpdatesPk(organizationId),
      sk: organizationUpdatesSk(now),
      sk1: 'STATUS#NEW',
      sk2: 'SUBSTATUS#NEW_ENTRY',
      organizationID: organizationId,
      createdDate: now,
      modifiedDate: now,
      createdBy: `USER#${createdBy}`,
      updates,
      itemType: 'ORG_UPDATE',
    };
    try {
      await ddbDocClient.send(
        new PutCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Item: item,
        }) as any,
      );
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.info({ event: 'organization_update_audit_created', message: 'Organization update audit created' });
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.error({ event: 'organization_update_audit_error', err: serializeError(err), message: 'Failed to create organization update audit' });
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
        }) as any,
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
      const result:any = await ddbDocClient.send(
        new GetCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          Key: {
            pk: organizationPk(organizationId),
            sk: organizationMetadataSk(),
          },
        }) as any,
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

  async listOrganizations(filters?: {
    organizationId?: string;
    status?: string[];
    organizationType?: string[];
    adminName?: string;
    organizationName?: string;
    country?: string;
    state?: string;
    city?: string;
    assignedPackagesName?: string[];
    limit?: number;
    nextPaginationKey?: string;
  }): Promise<{ items: Organization[]; nextPaginationKey?: string | null }> {
    try {
      const params: {
        TableName: string;
        IndexName: string;
        KeyConditionExpression: string;
        ExpressionAttributeValues: Record<string, unknown>;
        ExpressionAttributeNames?: Record<string, string>;
        FilterExpression?: string;
        ExclusiveStartKey?: Record<string, unknown>;
        Limit?: number;
        ProjectionExpression?: string;
      } = {
        TableName: ORGANIZATION_TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :gsi1pk',
        ExpressionAttributeValues: {
          ':gsi1pk': 'ORG_LIST',
        },
      };

      const exprNames: Record<string, string> = {};
      const filtersExpr: string[] = [];

      const status = filters?.status?.filter((value) => value);
      if (status?.length) {
        exprNames['#status'] = 'status';
        const statusFilters = status.map((value, index) => {
          const key = `:status${index}`;
          params.ExpressionAttributeValues[key] = value.toUpperCase();
          return `#status = ${key}`;
        });
        filtersExpr.push(`(${statusFilters.join(' OR ')})`);
      }

      const organizationType = filters?.organizationType?.filter((value) => value);
      if (organizationType?.length) {
        exprNames['#searchFields'] = 'searchFields';
        exprNames['#organizationType'] = 'organizationType';
        const typeFilters = organizationType.map((value, index) => {
          const key = `:orgType${index}`;
          params.ExpressionAttributeValues[key] = value.toLowerCase();
          return `contains(#searchFields.#organizationType, ${key})`;
        });
        filtersExpr.push(`(${typeFilters.join(' OR ')})`);
      }

      if (filters?.organizationName) {
        exprNames['#searchFields'] = 'searchFields';
        exprNames['#name'] = 'name';
        params.ExpressionAttributeValues[':orgName'] = filters.organizationName.toLowerCase();
        filtersExpr.push('contains(#searchFields.#name, :orgName)');
      }

      if (filters?.adminName) {
        exprNames['#adminDetails'] = 'adminDetails';
        exprNames['#adminName'] = 'adminName';
        params.ExpressionAttributeValues[':adminName'] = filters.adminName.toLowerCase();
        filtersExpr.push('contains(#adminDetails.#adminName, :adminName)');
      }

      if (filters?.country || filters?.state || filters?.city) {
        exprNames['#searchFields'] = 'searchFields';
        if (filters.country) {
          exprNames['#country'] = 'country';
          params.ExpressionAttributeValues[':country'] = filters.country.toLowerCase();
          filtersExpr.push('#searchFields.#country = :country');
        }
        if (filters.state) {
          exprNames['#state'] = 'state';
          params.ExpressionAttributeValues[':state'] = filters.state.toLowerCase();
          filtersExpr.push('#searchFields.#state = :state');
        }
        if (filters.city) {
          exprNames['#city'] = 'city';
          params.ExpressionAttributeValues[':city'] = filters.city.toLowerCase();
          filtersExpr.push('#searchFields.#city = :city');
        }
      }

      const assignedPackagesName = filters?.assignedPackagesName?.filter((value) => value);
      if (assignedPackagesName?.length) {
        exprNames['#assignedPackagesName'] = 'assignedPackagesName';
        const pkgFilters = assignedPackagesName.map((value, index) => {
          const key = `:pkgName${index}`;
          params.ExpressionAttributeValues[key] = value.toLowerCase();
          return `contains(#assignedPackagesName, ${key})`;
        });
        filtersExpr.push(`(${pkgFilters.join(' OR ')})`);
      }

      if (filters?.organizationId) {
        exprNames['#parentOrgId'] = 'parentOrgId';
        exprNames['#organizationId'] = 'organizationId';
        params.ExpressionAttributeValues[':orgId'] = filters.organizationId;
        filtersExpr.push('(#parentOrgId = :orgId OR #organizationId = :orgId)');
      }

      appendNonDeletedFilter(filtersExpr, exprNames, params.ExpressionAttributeValues);

      if (filtersExpr.length) {
        params.FilterExpression = filtersExpr.join(' AND ');
      }

      params.ProjectionExpression = buildOrgListProjectionExpression(exprNames);

      if (Object.keys(exprNames).length) {
        params.ExpressionAttributeNames = exprNames;
      }

      const paginationKey = filters?.nextPaginationKey?.trim();
      let lastEvaluatedKey = paginationKey
        ? decodeOrgListPaginationKey(paginationKey)
        : undefined;

      const items: Organization[] = [];
      const limit =
        filters?.limit && filters.limit > 0 ? Math.min(filters.limit, MAX_ORG_LIST_LIMIT) : DEFAULT_ORG_LIST_LIMIT;

      let nextPaginationKey: string | null = null;

      do {
        if (lastEvaluatedKey) {
          params.ExclusiveStartKey = lastEvaluatedKey;
        } else {
          delete params.ExclusiveStartKey;
        }

        const remaining = limit - items.length;
        params.Limit = Math.min(Math.max(remaining, 1), MAX_ORG_LIST_LIMIT);

        const response = await ddbDocClient.send(new QueryCommand(params));
        const pageItems = (response.Items ?? []) as Organization[];
        if (pageItems.length) {
          items.push(...pageItems);
        }

        const dynamoLastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;

        if (items.length >= limit) {
          const pageItemsCount = pageItems.length;
          const hasMoreInCurrentBatch = pageItemsCount > remaining;
          const trimmedItems = items.slice(0, limit);
          items.length = 0;
          items.push(...trimmedItems);

          if (hasMoreInCurrentBatch) {
            nextPaginationKey =
              encodeOrgListPaginationKey(
                buildOrgListCursorKey(trimmedItems[trimmedItems.length - 1] as unknown as Record<string, unknown>),
              ) ?? null;
          } else if (dynamoLastEvaluatedKey) {
            nextPaginationKey = encodeOrgListPaginationKey(dynamoLastEvaluatedKey);
          }
          break;
        }

        lastEvaluatedKey = dynamoLastEvaluatedKey;
      } while (lastEvaluatedKey);

      const sanitized = items.map((item) => this.sanitizeOrganization(item));

      return {
        items: sanitized,
        nextPaginationKey,
      };
    } catch (err) {
      const logger = createChildLogger(baseLogger, {});
      logger.error({ event: 'organization_list_error', err: serializeError(err), message: 'Failed to list organizations' });
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
        }) as any,
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
      const result:any = await ddbDocClient.send(
        new QueryCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': organizationPk(organizationId),
            ':skPrefix': 'ORG_FILE#',
          },
        }) as any,
      );

      return (result.Items ?? []) as OrganizationFile[];
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.error({ event: 'organization_files_list_error', err: serializeError(err), message: 'Failed to list organization files' });
      throw err;
    }
  }

  async getOrganizationBySubdomain(subdomain: string, provider?: string): Promise<Organization | null> {
    const normalizedSubdomain = subdomain.trim().toLowerCase();
    if (!normalizedSubdomain) return null;
    const resolvedProvider = (provider || 'TRU_TECH').toUpperCase();
    try {
      const exprValues: Record<string, unknown> = {
        ':gsi2pk': `PROVIDER#${resolvedProvider}`,
        ':gsi2sk': `LOOKUP#${normalizedSubdomain}#`,
      };
      const response:any = await ddbDocClient.send(
        new QueryCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          IndexName: 'GSI2',
          KeyConditionExpression: 'gsi2pk = :gsi2pk AND begins_with(gsi2sk, :gsi2sk)',
          ExpressionAttributeValues: exprValues,
          Limit: 1,
        }) as any,
      );
      const item = (response.Items?.[0] as Organization | undefined) ?? null;
      if (!item || item.deleted === true) {
        return null;
      }
      return this.sanitizeOrganization(item);
    } catch (err) {
      const logger = createChildLogger(baseLogger, { subdomain: normalizedSubdomain, provider: resolvedProvider });
      logger.error({ event: 'organization_get_by_subdomain_error', err: serializeError(err) });
      throw err;
    }
  }

  async getOrganizationsByProvider(provider: string): Promise<Organization[]> {
    const resolvedProvider = provider.trim().toUpperCase();
    if (!resolvedProvider) return [];
    try {
      const response:any = await ddbDocClient.send(
        new QueryCommand({
          TableName: ORGANIZATION_TABLE_NAME,
          IndexName: 'GSI2',
          KeyConditionExpression: 'gsi2pk = :gsi2pk',
          ExpressionAttributeValues: {
            ':gsi2pk': `PROVIDER#${resolvedProvider}`,
          },
        }) as any,
      );
      return (response.Items ?? [])
        .map((item:any) => item as Organization)
        .filter((item:any) => item.deleted !== true)
        .map((item:any) => this.sanitizeOrganization(item));
    } catch (err) {
      const logger = createChildLogger(baseLogger, { provider: resolvedProvider });
      logger.error({ event: 'organization_get_by_provider_error', err: serializeError(err) });
      throw err;
    }
  }

}
