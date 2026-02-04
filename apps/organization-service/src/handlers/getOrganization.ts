import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { UserRepository } from '../repositories/user.repository';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { OrganizationNotFoundError } from '../utils/errors';
import { ApiResponse } from '@api-hub/utils';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();
const userRepository = new UserRepository();

const buildAdminAddress = (user?: Record<string, unknown>) => {
  if (!user) return undefined;
  const address = {
    address: user.address,
    city: user.city,
    state: user.state,
    country: user.country,
    postalCode: user.postalCode,
    countryCode: user.countryCode,
  } as Record<string, unknown>;
  const hasAny = Object.values(address).some((value) => value !== undefined && value !== null && String(value).trim() !== '');
  return hasAny ? address : undefined;
};

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const organizationId = event.pathParameters?.organizationId;

  if (!organizationId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST' },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, organizationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'getOrganization_received' });

  try {
    const organization = await organizationService.getOrganization(organizationId);
    const authHeader =
      event.headers?.Authorization ||
      event.headers?.authorization ||
      event.headers?.AUTHORIZATION;
    
    const orgRecord = organization as unknown as Record<string, unknown>;
    
    // Enrich admin details
    const adminDetails = Array.isArray(organization.adminDetails) ? organization.adminDetails : [];
    let enrichedAdminDetails: unknown = null;
    
    if (adminDetails.length > 0) {
      const enrichedAdmins = await Promise.all(
        adminDetails.map(async (adminDetail: any) => {
          const adminId = adminDetail?.adminId;
          if (!adminId) return adminDetail;
          try {
            const user = await userRepository.getUser(organizationId, adminId, authHeader);
            if (!user) return adminDetail;
            const mergedAddress = adminDetail?.adminAddress ?? buildAdminAddress(user);
            return {
              ...adminDetail,
              adminName: adminDetail?.adminName ?? user?.fullName ?? user?.name,
              namePrefix: adminDetail?.namePrefix ?? user?.namePrefix,
              phoneCode: adminDetail?.phoneCode ?? user?.phoneCode,
              phoneNumber: adminDetail?.phoneNumber ?? user?.phoneNumber,
              profilePic: adminDetail?.profilePic ?? user?.profilePic,
              emailAddress: adminDetail?.emailAddress ?? user?.emailAddress,
              adminAddress: mergedAddress,
            };
          } catch (err) {
            logger.warn({ event: 'getOrganization_admin_user_failed', adminId, err: serializeError(err) });
            return adminDetail;
          }
        }),
      );
      // Use first admin if array, otherwise use the object
      enrichedAdminDetails = Array.isArray(enrichedAdmins) && enrichedAdmins.length > 0 
        ? enrichedAdmins[0] 
        : enrichedAdmins;
    } else if (organization.adminDetails && !Array.isArray(organization.adminDetails)) {
      enrichedAdminDetails = organization.adminDetails;
    }
    
    // Transform organization to match the desired response structure
    const transformed: Record<string, unknown> = {};
    
    // Add accountAlias (organizationId)
    transformed.accountAlias = organization.organizationId;
    
    // Add adminDetails if it exists
    if (enrichedAdminDetails) {
      transformed.adminDetails = enrichedAdminDetails;
    }
    
    // Add createdAt if it exists
    if (organization.createdAt || organization.createdDate) {
      transformed.createdAt = organization.createdAt || organization.createdDate;
    }
    
    // Add createdBy if it exists
    if (organization.createdBy) {
      transformed.createdBy = organization.createdBy;
    }
    
    // Add formAlert if it exists
    if (orgRecord.formAlert !== undefined) {
      transformed.formAlert = orgRecord.formAlert;
    }
    
    // Add modifiedBy if it exists
    if (organization.modifiedBy) {
      transformed.modifiedBy = organization.modifiedBy;
    }
    
    // Add modifiedDate
    transformed.modifiedDate = organization.modifiedDate;
    
    // Build organizationInfo - preserve all existing fields
    if (organization.organizationInfo && typeof organization.organizationInfo === 'object') {
      transformed.organizationInfo = { ...(organization.organizationInfo as Record<string, unknown>) };
      const orgInfo = transformed.organizationInfo as Record<string, unknown>;
      
      // Ensure name field exists
      if (orgInfo.organizationName && !orgInfo.name) {
        orgInfo.name = orgInfo.organizationName;
      }
      
      // Ensure organizationID exists
      if (!orgInfo.organizationID && organization.organizationId) {
        orgInfo.organizationID = organization.organizationId;
      }
      
      // Ensure address structure is correct
      if (!orgInfo.address || typeof orgInfo.address !== 'object') {
        const addressObj: Record<string, unknown> = {};
        if (organization.country) addressObj.country = organization.country;
        if (organization.address) addressObj.address = organization.address;
        if (organization.state) addressObj.state = organization.state;
        if (organization.city) addressObj.city = organization.city;
        if (organization.postalCode) addressObj.postalCode = organization.postalCode;
        if (organization.countryCode) addressObj.countryCode = organization.countryCode;
        
        if (Object.keys(addressObj).length > 0) {
          orgInfo.address = addressObj;
        }
      } else {
        // Address exists, ensure it has all available fields from item
        const existingAddress = orgInfo.address as Record<string, unknown>;
        if (organization.country && !existingAddress.country) existingAddress.country = organization.country;
        if (organization.address && !existingAddress.address) existingAddress.address = organization.address;
        if (organization.state && !existingAddress.state) existingAddress.state = organization.state;
        if (organization.city && !existingAddress.city) existingAddress.city = organization.city;
        if (organization.postalCode && !existingAddress.postalCode) existingAddress.postalCode = organization.postalCode;
        if (organization.countryCode && !existingAddress.countryCode) existingAddress.countryCode = organization.countryCode;
      }
      
      // Add missing fields from item if not already in orgInfo (only if they exist)
      if (!orgInfo.organizationName && organization.name) {
        orgInfo.organizationName = organization.name;
      }
      if (!orgInfo.name && organization.name) {
        orgInfo.name = organization.name;
      }
      if (!orgInfo.organizationType && organization.organizationType) {
        orgInfo.organizationType = organization.organizationType;
      }
      if (!orgInfo.phoneCode && organization.phoneCode) {
        orgInfo.phoneCode = organization.phoneCode;
      }
      if (!orgInfo.phoneNumber && organization.phoneNumber) {
        orgInfo.phoneNumber = organization.phoneNumber;
      }
      if (!orgInfo.emailAddress && organization.email) {
        orgInfo.emailAddress = organization.email;
      }
      if (!orgInfo.hospitalBio && organization.hospitalBio !== undefined) {
        orgInfo.hospitalBio = organization.hospitalBio;
      }
      if (!orgInfo.hospitalImage && organization.hospitalImage) {
        orgInfo.hospitalImage = organization.hospitalImage;
      }
      if (!orgInfo.createdDate && (organization.createdAt || organization.createdDate)) {
        orgInfo.createdDate = organization.createdAt || organization.createdDate;
      }
      if (!orgInfo.modifiedDate && organization.modifiedDate) {
        orgInfo.modifiedDate = organization.modifiedDate;
      }
    } else {
      // Build organizationInfo from flat fields
      const orgInfo: Record<string, unknown> = {
        organizationID: organization.organizationId,
        organizationName: organization.name,
        name: organization.name,
      };
      
      if (organization.organizationType) orgInfo.organizationType = organization.organizationType;
      if (organization.phoneCode) orgInfo.phoneCode = organization.phoneCode;
      if (organization.phoneNumber) orgInfo.phoneNumber = organization.phoneNumber;
      if (organization.email) orgInfo.emailAddress = organization.email;
      if (organization.hospitalBio !== undefined) orgInfo.hospitalBio = organization.hospitalBio;
      if (organization.hospitalImage) orgInfo.hospitalImage = organization.hospitalImage;
      if (organization.createdAt || organization.createdDate) {
        orgInfo.createdDate = organization.createdAt || organization.createdDate;
      }
      if (organization.modifiedDate) {
        orgInfo.modifiedDate = organization.modifiedDate;
      }
      
      // Build address object
      const addressObj: Record<string, unknown> = {};
      if (organization.country) addressObj.country = organization.country;
      if (organization.address) addressObj.address = organization.address;
      if (organization.state) addressObj.state = organization.state;
      if (organization.city) addressObj.city = organization.city;
      if (organization.postalCode) addressObj.postalCode = organization.postalCode;
      if (organization.countryCode) addressObj.countryCode = organization.countryCode;
      
      if (Object.keys(addressObj).length > 0) {
        orgInfo.address = addressObj;
      }
      
      transformed.organizationInfo = orgInfo;
    }
    
    // Add searchFields if it exists
    if (organization.searchFields && typeof organization.searchFields === 'object') {
      transformed.searchFields = organization.searchFields;
    }
    
    // Add status
    transformed.status = organization.status;
    
    // Add traceId if it exists
    if (organization.traceId) {
      transformed.traceId = organization.traceId;
    }
    
    // Add supportedRelations if it exists
    if (orgRecord.supportedRelations !== undefined) {
      transformed.supportedRelations = orgRecord.supportedRelations;
    }
    
    // Add linkedOrganizations if it exists
    if (orgRecord.linkedOrganizations !== undefined) {
      transformed.linkedOrganizations = orgRecord.linkedOrganizations;
    }
    
    // Add mobileScreens if it exists
    if (orgRecord.mobileScreens !== undefined) {
      transformed.mobileScreens = orgRecord.mobileScreens;
    }
    
    // Add mobileScreen if it exists
    if (orgRecord.mobileScreen !== undefined) {
      transformed.mobileScreen = orgRecord.mobileScreen;
    }
    
    // Add features if it exists
    if (orgRecord.features !== undefined) {
      transformed.features = orgRecord.features;
    }
    
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}`, 200, duration, correlationId);
    return ApiResponse.ok(
      transformed,
      { title: 'Get organization details success', description: 'The get organization details completed successfully.' },
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof OrganizationNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}`, 404, duration, correlationId);
      return ApiResponse.notFound(
        'ORGANIZATION.ORGANIZATION_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'ORGANIZATION_NOT_FOUND' },
      );
    }
    logger.error({ event: 'getOrganization_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}`, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'ORGANIZATION.GET_ORGANIZATION_FAILED',
      { requestId: correlationId, event },
      { code: 'GET_ORGANIZATION_FAILED' },
    );
  }
};
