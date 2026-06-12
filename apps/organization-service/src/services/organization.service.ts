import { OrganizationRepository } from '../repositories/organization.repository';
import { UserRepository } from '../repositories/user.repository';
import { createLogger, serializeError, createPerformanceTimer, createChildLogger } from '@api-hub/observability';
import { SecretManagerService } from '@api-hub/service-clients';
import {
  Organization,
  OrganizationMetadata,
  OrganizationFile,
  OrganizationConfigPatch,
  OrganizationConfigData,
  OrgConfigEntity,
  OrgConfigStatus,
  OrgConfigChangeType,
  ORG_CONFIG_CHANGE_TYPE,
  ORGANIZATION_CONFIG_DATA_KEYS,
} from '../models';
import {
  OrganizationNotFoundError,
  OrganizationNotActiveError,
  LinkedOrganizationsNotFoundError,
  OrgConfigDraftNotFoundError,
  OrgConfigPublishError,
  InvalidMetadataValueError,
} from '../utils/errors';
import { publishEvent } from '../events/event.publisher';
import { randomUUID } from 'crypto';
import { notifyAdminForOrganizationActivated } from './notification.service';
import { extractSubdomainFromUrl } from '../utils/helpers';
import { isNewOrgConfigFlowEnabled } from '../utils/featureFlags';
import {
  mapLegacyOrganizationConfigToNew,
  mergeLegacyOrganizationConfigPatch,
  mergeOrganizationConfigData,
  toOrganizationConfigData,
} from '../utils/organizationConfig.mapper';
import {
  buildOrgCapabilities,
  deriveCategoryConditionPairs,
} from '../utils/organizationConfig.capabilities';
import {
  computeChangedConfigSections,
  validateOrganizationConfigForPublish,
  type OrgConfigMetadataReader,
} from '../utils/organizationConfig.validator';
import { getMetadataRegistryClient } from '../clients/metadataRegistry.client';
import { publishOrgConfigPublishedEvent } from '../handlers/events/publisher/org-config-publisher';
import type { OrgConfigPublishedPayload } from '../handlers/events/outbound/org-config-published.event';
import { buildOrgListGsi1Sk } from '../utils/organizationList.sort';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

const LATEST_ORG_CONFIG_PATCH_KEYS: readonly (keyof OrgConfigEntity)[] = [
  'supportedCountries',
  'supportedLanguages',
  'supportedStates',
  'supportedCategories',
  'supportedConditions',
];

const LATEST_ORG_CONFIG_PROJECTION_GET: readonly (keyof OrgConfigEntity)[] = ['version', ...LATEST_ORG_CONFIG_PATCH_KEYS];

const areStringArraysEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const toComparableStringArray = (value: string | string[] | undefined): string[] => {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};

/**
 * Compares two org config snapshots field-by-field (replace semantics): a field missing
 * on `incoming` but present on `latest` counts as a change. Returns true when identical.
 */
const isSameLegacyOrganizationConfig = (
  merged: Required<OrganizationConfigPatch>,
  latest: OrgConfigEntity | null,
): boolean => {
  if (latest === null) {
    return false;
  }
  return (
    areStringArraysEqual(merged.supportedCountries, latest.supportedCountries ?? []) &&
    areStringArraysEqual(merged.supportedLanguages, latest.supportedLanguages ?? []) &&
    areStringArraysEqual(merged.supportedStates, latest.supportedStates ?? []) &&
    areStringArraysEqual(merged.supportedCategories, latest.supportedCategories ?? []) &&
    areStringArraysEqual(merged.supportedConditions, latest.supportedConditions ?? [])
  );
};

const isSameOrganizationConfig = (
  incoming: OrganizationConfigData,
  latest: OrganizationConfigData | null,
): boolean => {
  if (latest === null) return false;
  for (const key of ORGANIZATION_CONFIG_DATA_KEYS) {
    const incomingValue = incoming[key];
    const latestValue = latest[key];
    if (Array.isArray(incomingValue) || Array.isArray(latestValue)) {
      if (!areStringArraysEqual(toComparableStringArray(incomingValue), toComparableStringArray(latestValue))) {
        return false;
      }
    } else if ((incomingValue ?? undefined) !== (latestValue ?? undefined)) {
      return false;
    }
  }
  return true;
};

export class OrganizationService {
  private repository: OrganizationRepository;
  private userRepository: UserRepository;
  private secretManagerService: SecretManagerService;
  private metadataRegistryClient: OrgConfigMetadataReader;

  constructor(
    repository?: OrganizationRepository,
    userRepository?: UserRepository,
    secretManagerService?: SecretManagerService,
    metadataRegistryClient?: OrgConfigMetadataReader,
  ) {
    this.repository = repository ?? new OrganizationRepository();
    this.userRepository = userRepository ?? new UserRepository();
    this.secretManagerService = secretManagerService ?? new SecretManagerService();
    this.metadataRegistryClient = metadataRegistryClient ?? getMetadataRegistryClient();
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
      const organizationInfo =
        data.organizationInfo && typeof data.organizationInfo === 'object'
          ? {
              ...(data.organizationInfo as Record<string, unknown>),
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
      const resolvedSubdomain = data.subdomain ?? extractSubdomainFromUrl(data.integration?.apiBaseUrl);
      const resolvedProvider = (data.integration?.provider || 'TRU_TECH').toUpperCase();
      const integrationApiKey = data.integration?.apiKey?.trim();
      const generatedApiKeyRef = resolvedSubdomain ? `${resolvedSubdomain.toLowerCase()}apikey` : undefined;
      if (integrationApiKey && generatedApiKeyRef) {
        await this.secretManagerService.addApiKey(generatedApiKeyRef, integrationApiKey);
      }
      const sanitizedIntegration = data.integration
        ? {
            ...data.integration,
            provider: resolvedProvider,
            apiKeyRef: generatedApiKeyRef ?? data.integration.apiKeyRef,
            apiKey: undefined,
          }
        : undefined;

      const organization: Organization = {
        pk: `ORG#${organizationId}`,
        sk: 'ORG_DETAILS',
        gsi1pk: 'ORG_LIST',
        gsi1sk: buildOrgListGsi1Sk(now, organizationId),
        gsi2pk: resolvedSubdomain ? `PROVIDER#${resolvedProvider}` : undefined,
        gsi2sk:
          resolvedSubdomain
            ? `LOOKUP#${resolvedSubdomain.toLowerCase()}#ORG#${organizationId}`
            : undefined,
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
        adminDetails: data.adminDetails,
        modules: data.modules,
        devices: data.devices,
        supportedVitals: data.supportedVitals,
        organizationInfo,
        searchFields,
        website: data.website,
        subdomain: resolvedSubdomain,
        taxId: data.taxId,
        registrationNumber: data.registrationNumber,
        description: data.description,
        industry: data.industry,
        size: data.size,
        integration: sanitizedIntegration,
        sourceSystem: data.sourceSystem ?? (data.organizationType?.toUpperCase() === 'HMS' ? 'TruTech' : ''),
      };

      await this.repository.createOrganization(organization);

      await publishEvent(
        {
          eventId: randomUUID(),
          eventType: 'OrganizationCreated.v1',
          timestamp: new Date().toISOString(), 
          source: 'organization-service',
          meta: {
            correlationId: correlationId ?? randomUUID(),
            publishedAt: new Date().toISOString(),
            retryCount: 0,
          },
          eventVersion: '1.0.0',
          idempotencyKey: randomUUID(),
          payload: {
            organizationId,
            name: organization.name,
            email: organization.email,
            status: organization.status,
            createdDate: organization.createdAt ?? now,
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

  /**
   * Loads the latest organizationConfig record and shapes it as
   * `{ organizationConfig, organizationConfigVersion }`. Returns `null` when no
   * config exists. Shared by `getOrganization` and `getOrganizationConfig` so
   * the read-and-shape logic lives in one place.
   */
  private async loadLatestConfig(
    organizationId: string,
  ): Promise<{ organizationConfig: OrganizationConfigPatch; organizationConfigVersion: number } | null> {
    const latestConfig = await this.repository.getLatestOrganizationConfig(organizationId, {
      project: LATEST_ORG_CONFIG_PROJECTION_GET,
    });
    if (latestConfig === null) return null;
    return {
      organizationConfig: {
        supportedCountries: latestConfig.supportedCountries,
        supportedLanguages: latestConfig.supportedLanguages,
        supportedStates: latestConfig.supportedStates,
        supportedCategories: latestConfig.supportedCategories,
        supportedConditions: latestConfig.supportedConditions,
      },
      organizationConfigVersion: latestConfig.version,
    };
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

      const latestConfig = await this.loadLatestConfig(organizationId);
      const response: Organization = latestConfig === null ? organization : { ...organization, ...latestConfig };

      logger.info({ event: 'service_getOrganization_success' });
      timer.end();
      return response;
    } catch (err) {
      logger.error({ event: 'service_getOrganization_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  /**
   * Returns only the latest organizationConfig (no admin enrichment, devices,
   * mobile screens, etc). Used by `GET /organization/{organizationId}?view=config`.
   */
  async getOrganizationConfig(organizationId: string): Promise<{
    organizationId: string;
    organizationConfig?: OrganizationConfigPatch;
    organizationConfigVersion?: number;
  }> {
    const timer = createPerformanceTimer(baseLogger, 'getOrganizationConfig');
    const logger = createChildLogger(baseLogger, { organizationId });
    logger.info({ event: 'service_getOrganizationConfig_start' });

    try {
      const organization = await this.repository.getOrganization(organizationId);
      if (!organization) {
        throw new OrganizationNotFoundError(organizationId);
      }

      const latestConfig = await this.loadLatestConfig(organizationId);
      const response = {
        organizationId,
        ...(latestConfig ?? {}),
      };

      logger.info({ event: 'service_getOrganizationConfig_success' });
      timer.end();
      return response;
    } catch (err) {
      logger.error({ event: 'service_getOrganizationConfig_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async updateOrganization(
    organizationId: string,
    updates: Partial<Organization> & { organizationConfig?: OrganizationConfigPatch },
    correlationId?: string,
    userType?: string,
  ): Promise<Organization> {
    const timer = createPerformanceTimer(baseLogger, 'updateOrganization', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, organizationId });
    logger.info({ event: 'service_updateOrganization_start' });

    try {
      const existing = await this.repository.getOrganization(organizationId);
      if (!existing) {
        throw new OrganizationNotFoundError(organizationId);
      }

      const { organizationConfig, ...organizationUpdates } = updates;
      const normalizedUserType = String(userType ?? '').trim().toUpperCase();
      const canUpdateOrganizationConfig = normalizedUserType === 'ROOT_ADMIN';
      let configVersion: number | undefined;

      const resolvedSubdomain =
        organizationUpdates.subdomain ?? extractSubdomainFromUrl(organizationUpdates.integration?.apiBaseUrl) ?? existing.subdomain;
      if (resolvedSubdomain && !organizationUpdates.subdomain) {
        organizationUpdates.subdomain = resolvedSubdomain;
      }
      const updateIntegrationApiKey = organizationUpdates.integration?.apiKey?.trim();
      const generatedApiKeyRef = resolvedSubdomain ? `${resolvedSubdomain.toLowerCase()}apikey` : undefined;
      if (updateIntegrationApiKey && generatedApiKeyRef) {
        await this.secretManagerService.addApiKey(generatedApiKeyRef, updateIntegrationApiKey);
      }
      if (organizationUpdates.integration) {
        const resolvedProvider = (organizationUpdates.integration.provider || existing.integration?.provider || 'TRU_TECH').toUpperCase();
        organizationUpdates.integration = {
          ...(existing.integration || {}),
          ...organizationUpdates.integration,
          provider: resolvedProvider,
          apiKeyRef: generatedApiKeyRef ?? organizationUpdates.integration.apiKeyRef ?? existing.integration?.apiKeyRef,
          apiKey: undefined,
        };
      }

      const hasOrganizationFieldUpdates = Object.values(organizationUpdates).some((value) => value !== undefined);
      if (hasOrganizationFieldUpdates) {
        await this.repository.updateOrganization(organizationId, organizationUpdates);
      }

      if (organizationConfig && canUpdateOrganizationConfig) {
        if (isNewOrgConfigFlowEnabled()) {
          logger.info({
            event: 'service_updateOrganization_config_flow',
            flow: 'new',
            message: 'Using new org config flow',
          });
          const mappedPatch = mapLegacyOrganizationConfigToNew(organizationConfig, {
            modules: organizationUpdates.modules,
            devices: organizationUpdates.devices,
          });
          const latestConfig = await this.repository.getLatestOrganizationConfigVersionItem(organizationId);
          const mergedNewConfig = mergeOrganizationConfigData(mappedPatch, latestConfig);
          const saveResult = await this.saveOrganizationConfig(
            organizationId,
            mergedNewConfig,
            correlationId,
            updates.modifiedBy,
          );
          configVersion = saveResult.organizationConfigVersion;
        } else {
          logger.info({
            event: 'service_updateOrganization_config_flow',
            flow: 'legacy',
            message: 'Using legacy org config flow',
          });
          const latestConfig = await this.repository.getLatestOrganizationConfig(organizationId, {
            project: LATEST_ORG_CONFIG_PATCH_KEYS,
          });
          const mergedConfig = mergeLegacyOrganizationConfigPatch(organizationConfig, latestConfig);
          if (!isSameLegacyOrganizationConfig(mergedConfig, latestConfig)) {
            const configRecord = await this.repository.createOrganizationConfigVersion(
              organizationId,
              mergedConfig,
            );
            configVersion = configRecord.version;
          }
        }
      } else if (organizationConfig && !canUpdateOrganizationConfig) {
        logger.warn({
          event: 'service_updateOrganization_config_update_skipped',
          reason: 'organizationConfig update requires ROOT_ADMIN',
          userType: normalizedUserType || 'UNKNOWN',
        });
      }

      const updated = await this.repository.getOrganization(organizationId);
      if (!updated) {
        throw new OrganizationNotFoundError(organizationId);
      }

      const updatedFields: Record<string, unknown> = {};
      if (organizationUpdates.name !== undefined) updatedFields.name = organizationUpdates.name;
      if (organizationUpdates.email !== undefined) updatedFields.email = organizationUpdates.email;
      if (organizationUpdates.phone !== undefined) updatedFields.phone = organizationUpdates.phone;
      if (organizationUpdates.address !== undefined) updatedFields.address = organizationUpdates.address;
      if (organizationUpdates.city !== undefined) updatedFields.city = organizationUpdates.city;
      if (organizationUpdates.state !== undefined) updatedFields.state = organizationUpdates.state;
      if (organizationUpdates.country !== undefined) updatedFields.country = organizationUpdates.country;
      if (organizationUpdates.postalCode !== undefined) updatedFields.postalCode = organizationUpdates.postalCode;
      if (organizationUpdates.status !== undefined) updatedFields.status = organizationUpdates.status;
      if (organizationUpdates.website !== undefined) updatedFields.website = organizationUpdates.website;
      if (organizationUpdates.taxId !== undefined) updatedFields.taxId = organizationUpdates.taxId;
      if (organizationUpdates.registrationNumber !== undefined) updatedFields.registrationNumber = organizationUpdates.registrationNumber;
      if (organizationUpdates.description !== undefined) updatedFields.description = organizationUpdates.description;
      if (organizationUpdates.industry !== undefined) updatedFields.industry = organizationUpdates.industry;
      if (organizationUpdates.size !== undefined) updatedFields.size = organizationUpdates.size;
      if (organizationUpdates.adminDetails !== undefined) updatedFields.adminDetails = organizationUpdates.adminDetails;
      if (organizationConfig !== undefined && canUpdateOrganizationConfig) {
        updatedFields.organizationConfig = organizationConfig;
      }
      if (configVersion !== undefined) {
        updatedFields.organizationConfigVersion = configVersion;
      }

      await publishEvent(
        {
          eventId: randomUUID(),
          eventType: 'OrganizationUpdated.v1',
          timestamp: new Date().toISOString(),
          meta: {
            correlationId: correlationId ?? randomUUID(),
            publishedAt: new Date().toISOString(),
            retryCount: 0,
          },
          eventVersion: '1.0.0',
          idempotencyKey: randomUUID(),
          source: 'organization-service', 
          payload: {
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

  /**
   * Saves organization config as a new draft version (`CONFIG#v{n}`, `status = draft`).
   * Does NOT validate against the Metadata Registry, publish, emit events, or deactivate
   * any current version (that is the publish flow, out of scope here). If the incoming
   * config matches the latest version, no new version is created.
   */
  async saveOrganizationConfig(
    organizationId: string,
    input: OrganizationConfigData & { changeReason?: string },
    correlationId?: string,
    createdBy?: string,
  ): Promise<{
    organizationId: string;
    organizationConfigVersion: number;
    status: OrgConfigStatus;
    config: OrganizationConfigData;
  }> {
    const timer = createPerformanceTimer(baseLogger, 'saveOrganizationConfig', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, organizationId });
    logger.info({ event: 'service_saveOrganizationConfig_start' });

    try {
      const existing = await this.repository.getOrganization(organizationId);
      if (!existing) {
        throw new OrganizationNotFoundError(organizationId);
      }

      const { changeReason, ...configInput } = input;
      const incomingConfig: OrganizationConfigData = {};
      for (const key of ORGANIZATION_CONFIG_DATA_KEYS) {
        const value = configInput[key];
        if (value !== undefined) {
          (incomingConfig as Record<string, unknown>)[key] = value;
        }
      }

      const latestConfig = await this.repository.getLatestOrganizationConfigVersionItem(organizationId);
      const mergedConfig = mergeOrganizationConfigData(incomingConfig, latestConfig);

      if (isSameOrganizationConfig(mergedConfig, latestConfig)) {
        logger.info({
          event: 'service_saveOrganizationConfig_unchanged',
          organizationConfigVersion: latestConfig?.version,
        });
        timer.end();
        return {
          organizationId,
          organizationConfigVersion: latestConfig!.version,
          status: latestConfig!.status,
          config: mergedConfig,
        };
      }

      const draft = await this.repository.createOrganizationConfigDraftVersion(organizationId, mergedConfig, {
        changeReason,
        createdBy,
      });

      logger.info({ event: 'service_saveOrganizationConfig_success', organizationConfigVersion: draft.version });
      timer.end();
      return {
        organizationId,
        organizationConfigVersion: draft.version,
        status: draft.status,
        config: mergedConfig,
      };
    } catch (err) {
      logger.error({ event: 'service_saveOrganizationConfig_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  /**
   * Validates metadata + relations, activates the target draft config, and emits
   * `OrgConfigPublished.v1` via EventBridge. Does not use the legacy SNS publisher.
   */
  async publishOrganizationConfig(
    organizationId: string,
    options: {
      authHeader?: string;
      publishedBy?: string;
      changeReason?: string;
      version?: number;
      correlationId?: string;
    } = {},
  ): Promise<{
    organizationId: string;
    organizationConfigVersion: number;
    status: OrgConfigStatus;
    config: OrganizationConfigData;
    orgCapabilities: string[];
    changedSections: string[];
    changeType: OrgConfigChangeType;
  }> {
    const timer = createPerformanceTimer(baseLogger, 'publishOrganizationConfig', options.correlationId);
    const logger = createChildLogger(baseLogger, { correlationId: options.correlationId, organizationId });
    logger.info({ event: 'service_publishOrganizationConfig_start' });

    try {
      const existing = await this.repository.getOrganization(organizationId);
      if (!existing) {
        throw new OrganizationNotFoundError(organizationId);
      }

      const authHeader = options.authHeader?.trim();
      if (!authHeader) {
        throw new InvalidMetadataValueError('Authorization header is required to publish organization config');
      }

      const correlationId = options.correlationId ?? randomUUID();

      const draftItem =
        options.version !== undefined
          ? await this.repository.getOrganizationConfigByVersion(organizationId, options.version)
          : await this.repository.getLatestDraftOrganizationConfig(organizationId);

      if (!draftItem) {
        throw new OrgConfigDraftNotFoundError(organizationId);
      }

      const config = toOrganizationConfigData(draftItem);

      if (draftItem.status === OrgConfigStatus.ACTIVE) {
        logger.info({
          event: 'service_publishOrganizationConfig_already_active',
          organizationConfigVersion: draftItem.version,
        });
        timer.end();
        return {
          organizationId,
          organizationConfigVersion: draftItem.version,
          status: OrgConfigStatus.ACTIVE,
          config,
          orgCapabilities: draftItem.orgCapabilities ?? [],
          changedSections: draftItem.changedSections ?? [],
          changeType: draftItem.changeType ?? ORG_CONFIG_CHANGE_TYPE.UPDATE,
        };
      }

      if (draftItem.status !== OrgConfigStatus.DRAFT) {
        throw new OrgConfigDraftNotFoundError(organizationId);
      }

      const validationContext = await validateOrganizationConfigForPublish(
        config,
        this.metadataRegistryClient,
        authHeader,
      );

      const categoryConditionPairs = deriveCategoryConditionPairs(
        config,
        validationContext.conditionsByCategory,
      );
      const orgCapabilities = buildOrgCapabilities(categoryConditionPairs);

      const previousActive = await this.repository.getActiveOrganizationConfigItem(organizationId);
      const previousConfig = toOrganizationConfigData(previousActive);
      const changedSections = computeChangedConfigSections(config, previousConfig);
      const changeType =
        previousActive === null ? ORG_CONFIG_CHANGE_TYPE.INITIAL : ORG_CONFIG_CHANGE_TYPE.UPDATE;
      const publishedAtMs = Date.now();
      const publishedAtIso = new Date(publishedAtMs).toISOString();

      const published = await this.repository.publishOrganizationConfigVersion(organizationId, draftItem.version, {
        publishedBy: options.publishedBy,
        publishedAt: publishedAtMs,
        changeReason: options.changeReason ?? draftItem.changeReason,
        changedSections,
        changeType,
        orgCapabilities,
      });

      const eventPayload: OrgConfigPublishedPayload = {
        organizationId,
        orgConfigVersion: published.version,
        changeType,
        changedSections,
        publishedAt: publishedAtIso,
        ...(options.publishedBy !== undefined ? { publishedBy: options.publishedBy } : {}),
      };

      try {
        await publishOrgConfigPublishedEvent(eventPayload, { organizationId, correlationId });
      } catch (err) {
        logger.error({
          event: 'service_publishOrganizationConfig_event_failed',
          err: serializeError(err),
          organizationConfigVersion: published.version,
        });
        throw new OrgConfigPublishError('Failed to publish OrgConfigPublished.v1 event');
      }

      logger.info({
        event: 'service_publishOrganizationConfig_success',
        organizationConfigVersion: published.version,
      });
      timer.end();
      return {
        organizationId,
        organizationConfigVersion: published.version,
        status: OrgConfigStatus.ACTIVE,
        config,
        orgCapabilities,
        changedSections,
        changeType,
      };
    } catch (err) {
      logger.error({ event: 'service_publishOrganizationConfig_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  /**
   * Saves org config as draft, then validates and publishes it as ACTIVE.
   * Used by `PUT /organization/{organizationId}/config`.
   */
  async saveAndPublishOrganizationConfig(
    organizationId: string,
    input: OrganizationConfigData & { changeReason?: string },
    options: {
      correlationId?: string;
      createdBy?: string;
      authHeader?: string;
    } = {},
  ): Promise<{
    organizationId: string;
    organizationConfigVersion: number;
    status: OrgConfigStatus;
    config: OrganizationConfigData;
    orgCapabilities?: string[];
  }> {
    const saveResult = await this.saveOrganizationConfig(
      organizationId,
      input,
      options.correlationId,
      options.createdBy,
    );

    if (saveResult.status === OrgConfigStatus.ACTIVE) {
      return {
        organizationId,
        organizationConfigVersion: saveResult.organizationConfigVersion,
        status: OrgConfigStatus.ACTIVE,
        config: saveResult.config,
        orgCapabilities: undefined,
      };
    }

    const publishResult = await this.publishOrganizationConfig(organizationId, {
      version: saveResult.organizationConfigVersion,
      authHeader: options.authHeader,
      publishedBy: options.createdBy,
      changeReason: input.changeReason,
      correlationId: options.correlationId,
    });

    return {
      organizationId,
      organizationConfigVersion: publishResult.organizationConfigVersion,
      status: publishResult.status,
      config: publishResult.config,
      orgCapabilities: publishResult.orgCapabilities,
    };
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
          timestamp: new Date().toISOString(),
          meta: {
            correlationId: correlationId ?? randomUUID(),
            publishedAt: new Date().toISOString(),
            retryCount: 0,
          },
          eventVersion: '1.0.0',
          idempotencyKey: randomUUID(),
          source: 'organization-service', 
          payload: {
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
          timestamp: new Date().toISOString(), 
          source: 'organization-service',
          meta: {
            correlationId: correlationId ?? randomUUID(),
            publishedAt: new Date().toISOString(),
            retryCount: 0,
          },
          eventVersion: '1.0.0',
          idempotencyKey: randomUUID(),
          payload: {
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
          timestamp: new Date().toISOString(),
          source: 'organization-service',
          meta: {
            correlationId: correlationId ?? randomUUID(),
            publishedAt: new Date().toISOString(),
            retryCount: 0,
          },
          eventVersion: '1.0.0',
          idempotencyKey: randomUUID(),
          payload: {
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

  async linkUnlinkOrganizations(
    fromOrg: string,
    toOrg: string,
    action: 'LINK' | 'UNLINK',
    userId: string,
    userType?: string,
    correlationId?: string,
  ): Promise<{ message: string }> {
    const timer = createPerformanceTimer(baseLogger, 'linkUnlinkOrganizations', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, fromOrg, toOrg, action });

    // if (userType !== 'ROOT_ADMIN') {
    //   throw new PermissionDeniedError();
    // }

    const [fromOrgDetails, toOrgDetails] = await Promise.all([
      this.repository.getOrganization(fromOrg),
      this.repository.getOrganization(toOrg),
    ]);

    if (!fromOrgDetails || !toOrgDetails) {
      const missing = !fromOrgDetails ? fromOrg : toOrg;
      throw new OrganizationNotFoundError(missing);
    }

    if (action === 'LINK') {
      if (toOrgDetails.status !== 'ACTIVE') {
        throw new OrganizationNotActiveError(toOrg);
      }
      const fromOrgType = fromOrgDetails.organizationType ?? '';
      const toOrgType = toOrgDetails.organizationType ?? '';
      await this.repository.createLink(fromOrg, toOrg, fromOrgType, toOrgType);
      await Promise.all([
        this.repository.createOrgUpdate(fromOrg, `${fromOrg} Org linked with ${toOrg}`, userId),
        this.repository.createOrgUpdate(toOrg, `${toOrg} Org linked with ${fromOrg}`, userId),
      ]);
      logger.info({ event: 'service_linkUnlink_link_success' });
      timer.end();
      return { message: 'Org linked successfully' };
    }

    if (action === 'UNLINK') {
      await this.repository.deleteLink(fromOrg, toOrg);
      await Promise.all([
        this.repository.createOrgUpdate(fromOrg, `${fromOrg} Org unlinked with ${toOrg}`, userId),
        this.repository.createOrgUpdate(toOrg, `${toOrg} Org unlinked with ${fromOrg}`, userId),
      ]);
      logger.info({ event: 'service_linkUnlink_unlink_success' });
      timer.end();
      return { message: 'Org unlinked successfully' };
    }

    timer.end();
    throw new Error('Invalid action; must be LINK or UNLINK');
  }

  async setOrganizationStatus(
    organizationId: string,
    status: 'ACTIVE' | 'HOLD' | 'DISABLED',
    userId?: string,
    userType?: string,
    correlationId?: string,
    authHeader?: string,
  ): Promise<{ message: string }> {
    const timer = createPerformanceTimer(baseLogger, 'setOrganizationStatus', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, organizationId, status });

    // if (userType !== 'ROOT_ADMIN') {
    //   throw new PermissionDeniedError();
    // }

    const org = await this.repository.getOrganization(organizationId);
    if (!org) {
      throw new OrganizationNotFoundError(organizationId);
    }

    const now = Date.now();
    await this.repository.updateOrganizationStatus(organizationId, status, now);

    if (status === 'ACTIVE') {
      await this.notifyAdminsOrganizationActivated(org, authHeader, correlationId, logger);
    }

    logger.info({ event: 'service_setOrganizationStatus_success' });
    timer.end();
    return { message: 'Organization status updated' };
  }

  private async notifyAdminsOrganizationActivated(
    org: Organization,
    authHeader: string | undefined,
    correlationId: string | undefined,
    logger: ReturnType<typeof createChildLogger>,
  ): Promise<void> {
    const adminDetails = Array.isArray(org.adminDetails) ? org.adminDetails : [];
    if (adminDetails.length === 0) {
      logger.info({ event: 'service_setOrganizationStatus_no_admins', message: 'No admin details to notify' });
      return;
    }

    const organizationId = org.organizationId;
    const organizationName = org.name ?? '';

    for (const adminDetail of adminDetails as Array<Record<string, unknown>>) {
      try {
        let email: string | undefined;
        let phone: string | undefined;
        let name: string | undefined;
        let adminUserId: string | undefined;

        const adminId = adminDetail?.adminId as string | undefined;
        if (adminId && authHeader) {
          const user = await this.userRepository.getUser(organizationId, adminId, authHeader);
          if (user) {
            adminUserId = adminId;
            email = (user.emailAddress as string) ?? (user.email as string) ?? undefined;
            name = (user.fullName as string) ?? (user.name as string) ?? undefined;
            const pc = String(user.phoneCode ?? '').trim();
            const pn = String(user.phoneNumber ?? '').trim();
            if (pc) {
              phone = pc.startsWith('+') ? `${pc}${pn}` : `+${pc}${pn}`;
            } else {
              phone = pn || undefined;
            }
          }
        }
        if (!email && !phone) {
          email = (adminDetail?.emailAddress as string) ?? undefined;
          const pc = String(adminDetail?.phoneCode ?? '').trim();
          const pn = String(adminDetail?.phoneNumber ?? '').trim();
          if (pc) {
            phone = pc.startsWith('+') ? `${pc}${pn}` : `+${pc}${pn}`;
          } else {
            phone = pn || undefined;
          }
          name = (adminDetail?.adminName as string) ?? (adminDetail?.name as string) ?? undefined;
          adminUserId = adminId;
        }

        if (!email && !phone) {
          logger.warn({ event: 'service_setOrganizationStatus_admin_no_contact', adminId, organizationId });
          continue;
        }

        await notifyAdminForOrganizationActivated({
          userId: adminUserId,
          email,
          phone,
          name,
          channels: ['email', 'sms'],
          template: 'ORGANIZATION_ACTIVATED',
          templateData: {
            organizationId,
            organizationName,
          },
          organizationId,
          organizationName,
          correlationId,
        });
      } catch (notifyErr) {
        logger.warn({
          event: 'service_setOrganizationStatus_notify_admin_failed',
          adminId: (adminDetail as Record<string, unknown>)?.adminId,
          err: serializeError(notifyErr),
        });
      }
    }
  }

  async getOrganizationCounts(correlationId?: string): Promise<{ total: number; orgType: Record<string, number> }> {
    const timer = createPerformanceTimer(baseLogger, 'getOrganizationCounts', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId });

    try {
      const items = await this.repository.getOrganizationCounts();
      let total = 0;
      const orgType: Record<string, number> = {};
      for (const { sk, count } of items) {
        orgType[sk] = count;
        total += count;
      }
      logger.info({ event: 'service_getOrganizationCounts_success', total });
      timer.end();
      return { total, orgType };
    } catch (err) {
      logger.error({ event: 'service_getOrganizationCounts_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async getLinkedOrganizations(
    organizationId: string,
    options?: {
      orgType?: string;
      preferredOrgId?: string;
      limit?: number;
      nextPaginationKey?: string;
    },
    correlationId?: string,
  ): Promise<{
    items: Array<{
      organizationId: string;
      name: string;
      organizationType?: string;
      admin?: unknown;
      address?: unknown;
      orgImage?: string;
      fromOrg: string;
      isPreferredOrg?: boolean;
    }>;
    nextPaginationKey?: string | null;
  }> {
    const timer = createPerformanceTimer(baseLogger, 'getLinkedOrganizations', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, organizationId });

    try {
      const linkResult = await this.repository.listLinkedOrganizationIds(organizationId, {
        orgType: options?.orgType,
        limit: options?.limit,
        nextPaginationKey: options?.nextPaginationKey,
      });

      if (!linkResult.items.length) {
        return {
          items: [],
          nextPaginationKey: null,
        };
      }

      const items = await Promise.all(
        linkResult.items.map(async (link) => {
          const org = await this.repository.getOrganization(link.linkedOrgId);
          const orgInfo = org?.organizationInfo as Record<string, unknown> | undefined;
          const name = org?.name ?? (orgInfo?.organizationName as string) ?? '';
          const organizationType = org?.organizationType ?? (orgInfo?.organizationType as string);
          const address = org?.address ?? orgInfo?.address;
          const orgImage = org?.hospitalImage ?? (orgInfo?.hospitalImage as string) ?? '';
          return {
            organizationId: link.linkedOrgId,
            name,
            organizationType,
            admin: org?.adminDetails,
            address,
            orgImage,
            fromOrg: link.fromOrg,
            isPreferredOrg: options?.preferredOrgId === link.linkedOrgId,
          };
        }),
      );

      logger.info({ event: 'service_getLinkedOrganizations_success', count: items.length });
      timer.end();
      return {
        items,
        nextPaginationKey: linkResult.nextPaginationKey ?? null,
      };
    } catch (err) {
      if (err instanceof LinkedOrganizationsNotFoundError) {
        timer.end();
        throw err;
      }
      logger.error({ event: 'service_getLinkedOrganizations_error', err: serializeError(err) });
      timer.end();
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
    const timer = createPerformanceTimer(baseLogger, 'listOrganizations');
    const logger = createChildLogger(baseLogger, { organizationId: filters?.organizationId });
    logger.info({ event: 'service_listOrganizations_start' });

    try {
      const result = await this.repository.listOrganizations(filters);
      logger.info({ event: 'service_listOrganizations_success', count: result.items.length });
      timer.end();
      return result;
    } catch (err) {
      logger.error({ event: 'service_listOrganizations_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  private async mapExternalTenantRecord(
    organization: Organization,
    fallbackApiBaseUrl?: string,
  ): Promise<{
    tenantId: string;
    organizationId: string;
    subdomain: string;
    apiBaseUrl: string;
    provider?: string;
    sourceSystem?: string;
    apiKey?: string;
  }> {
    const integration = organization.integration;
    const resolvedApiBaseUrl = integration?.apiBaseUrl?.trim() || fallbackApiBaseUrl || '';
    const resolvedSubdomain = organization.subdomain || integration?.subdomain || extractSubdomainFromUrl(resolvedApiBaseUrl) || '';
    let apiKey: string | undefined;
    const apiKeyRef = integration?.apiKeyRef?.trim();
    if (apiKeyRef) {
      const secret = await this.secretManagerService.fetchApiKey(apiKeyRef).catch(() => null);
      if (secret) {
        apiKey = secret;
      }
    }
    return {
      tenantId: resolvedSubdomain,
      organizationId: organization.organizationId,
      subdomain: resolvedSubdomain,
      apiBaseUrl: resolvedApiBaseUrl,
      provider: integration?.provider,
      sourceSystem: integration?.sourceSystem,
      apiKey,
    };
  }

  async getExternalTenants(input: {
    provider: string;
    apiBaseUrl?: string;
  }): Promise<{
    items: Array<{
      tenantId: string;
      organizationId: string;
      subdomain: string;
      apiBaseUrl: string;
      provider?: string;
      sourceSystem?: string;
      apiKey?: string;
    }>;
  }> {
    const provider = input.provider?.trim();
    if (!provider) {
      const err: any = new Error('provider is required');
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    const resolvedSubdomain = extractSubdomainFromUrl(input.apiBaseUrl);
    if (resolvedSubdomain) {
      const organization = await this.repository.getOrganizationBySubdomain(resolvedSubdomain, provider);
      if (!organization) {
        throw new OrganizationNotFoundError(resolvedSubdomain);
      }
      const item = await this.mapExternalTenantRecord(organization, input.apiBaseUrl);
      return { items: [item] };
    }
    const organizations = await this.repository.getOrganizationsByProvider(provider);
    const items = await Promise.all(organizations.map((organization) => this.mapExternalTenantRecord(organization)));
    return { items };
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
          timestamp: new Date().toISOString(), 
          source: 'organization-service',
          meta: {
            correlationId: correlationId ?? randomUUID(),
            publishedAt: new Date().toISOString(),
            retryCount: 0,
          },
          eventVersion: '1.0.0',
          idempotencyKey: randomUUID(),
          payload: {
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
          timestamp: now,
          source: 'organization-service', 
          meta: {
            correlationId: correlationId ?? randomUUID(),
            publishedAt: new Date().toISOString(),
            retryCount: 0,
          },
          eventVersion: '1.0.0',
          idempotencyKey: randomUUID(),
          payload: {
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
