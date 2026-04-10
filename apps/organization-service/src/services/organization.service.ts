import { OrganizationRepository } from '../repositories/organization.repository';
import { UserRepository } from '../repositories/user.repository';
import { createLogger, serializeError, createPerformanceTimer, createChildLogger } from '@api-hub/logger';
import { SecretManagerService } from '@api-hub/service-clients';
import { Organization, OrganizationMetadata, OrganizationFile, OrganizationUser } from '../models';
import { OrganizationNotFoundError, PermissionDeniedError, OrganizationNotActiveError, LinkedOrganizationsNotFoundError } from '../utils/errors';
import { publishEvent } from '../events/event.publisher';
import { randomUUID } from 'crypto';
import { notifyAdminForOrganizationActivated } from './notification.service';
import { extractSubdomainFromUrl } from '../utils/helpers';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

export class OrganizationService {
  private repository: OrganizationRepository;
  private userRepository: UserRepository;
  private secretManagerService: SecretManagerService;

  constructor(repository?: OrganizationRepository, userRepository?: UserRepository, secretManagerService?: SecretManagerService) {
    this.repository = repository ?? new OrganizationRepository();
    this.userRepository = userRepository ?? new UserRepository();
    this.secretManagerService = secretManagerService ?? new SecretManagerService();
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
      const integrationApiKey = data.integration?.apiKey?.trim();
      const generatedApiKeyRef = resolvedSubdomain ? `${resolvedSubdomain.toLowerCase()}apikey` : undefined;
      if (integrationApiKey && generatedApiKeyRef) {
        await this.secretManagerService.addApiKey(generatedApiKeyRef, integrationApiKey);
      }
      const sanitizedIntegration = data.integration
        ? {
            ...data.integration,
            apiKeyRef: generatedApiKeyRef ?? data.integration.apiKeyRef,
            apiKey: undefined,
          }
        : undefined;

      const organization: Organization = {
        pk: `ORG#${organizationId}`,
        sk: 'ORG_DETAILS',
        gsi1pk: 'ORG_LIST',
        gsi1sk: `ORG#${organizationId}`,
        gsi2pk: resolvedSubdomain ? `LOOKUP#${resolvedSubdomain.toLowerCase()}` : undefined,
        gsi2sk:
          resolvedSubdomain && data.integration?.providerId
            ? `PROVIDER#${data.integration.providerId}#ORG#${organizationId}`
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
        sourceSystem: data.sourceSystem || 'TruTech',
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

      const resolvedSubdomain =
        updates.subdomain ?? extractSubdomainFromUrl(updates.integration?.apiBaseUrl) ?? existing.subdomain;
      if (resolvedSubdomain && !updates.subdomain) {
        updates.subdomain = resolvedSubdomain;
      }
      const updateIntegrationApiKey = updates.integration?.apiKey?.trim();
      const generatedApiKeyRef = resolvedSubdomain ? `${resolvedSubdomain.toLowerCase()}apikey` : undefined;
      if (updateIntegrationApiKey && generatedApiKeyRef) {
        await this.secretManagerService.addApiKey(generatedApiKeyRef, updateIntegrationApiKey);
      }
      if (updates.integration) {
        updates.integration = {
          ...updates.integration,
          apiKeyRef: generatedApiKeyRef ?? updates.integration.apiKeyRef,
          apiKey: undefined,
        };
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
      if (updates.adminDetails !== undefined) updatedFields.adminDetails = updates.adminDetails;

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

  async getExternalTenantByApiBaseUrl(apiBaseUrl: string, providerId?: string): Promise<{
    tenantId: string;
    organizationId: string;
    subdomain: string;
  }> {
    const subdomain = extractSubdomainFromUrl(apiBaseUrl);
    if (!subdomain) {
      const err: any = new Error('Unable to extract subdomain from apiBaseUrl');
      err.statusCode = 400;
      err.code = 'INVALID_API_BASE_URL';
      throw err;
    }
    const organization = await this.repository.getOrganizationBySubdomain(subdomain, providerId);
    if (!organization) {
      throw new OrganizationNotFoundError(subdomain);
    }
    return {
      tenantId: organization.organizationId,
      organizationId: organization.organizationId,
      subdomain,
    };
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
