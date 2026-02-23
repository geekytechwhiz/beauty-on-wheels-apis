import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { UserRepository } from '../repositories/user.repository';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { OrganizationNotFoundError } from '../utils/errors';
import { ApiResponse } from '@api-hub/utils';
import { getMobileScreens } from '../utils/lambda.utils';
import { fetchOrganizationDevices, buildSupportedVitalsArray, vitalCodesFromOrgSupportedVitals } from '../utils/supportedVitals';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();
const userRepository = new UserRepository();

const buildAdminAddress = (user?: Record<string, unknown>) => {
  if (!user) return undefined;
  const address = {
    country: user.country,
    address: user.address,
    state: user.state,
    city: user.city,
    countryCode: user.countryCode,
    postalCode: user.postalCode,
  } as Record<string, unknown>;
  const hasAny = Object.values(address).some((value) => value !== undefined && value !== null && String(value).trim() !== '');
  return hasAny ? address : undefined;
};

const ensureHttps = (url?: string | null): string | undefined => {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('http://')) return trimmed.replace('http://', 'https://');
  return `https://${trimmed}`;
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
    const isRootOrg = organizationId.toUpperCase() === 'ROOT';
    
    // Transform organization to match the desired response structure
    const transformed: Record<string, unknown> = {};
    
    // Handle non-ROOT organizations
    if (!isRootOrg) {
      // Add accountAlias
      transformed.accountAlias = organization.organizationId;
      
      // Enrich and add adminDetails
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
              const adminRoleValue = adminDetail?.adminRole ?? user?.adminRole ?? user?.role;
              const roleNameValue = adminDetail?.roleName ?? user?.roleName ?? user?.role;
              const postalCodeValue = adminDetail?.postalCode ?? user?.postalCode ?? user?.zip;
              return {
                ...(mergedAddress && { adminAddress: mergedAddress }),
                adminId: adminDetail?.adminId ?? adminId,
                adminName: adminDetail?.adminName ?? user?.fullName ?? user?.name,
                ...(adminRoleValue && { adminRole: adminRoleValue }),
                emailAddress: adminDetail?.emailAddress ?? user?.emailAddress,
                namePrefix: adminDetail?.namePrefix ?? user?.namePrefix,
                phoneCode: adminDetail?.phoneCode ?? user?.phoneCode,
                phoneNumber: adminDetail?.phoneNumber ?? user?.phoneNumber,
                ...(postalCodeValue && { postalCode: postalCodeValue }),
                profilePic: adminDetail?.profilePic ?? user?.profilePic ?? '',
                ...(roleNameValue && { roleName: roleNameValue }),
              };
            } catch (err) {
              logger.warn({ event: 'getOrganization_admin_user_failed', adminId, err: serializeError(err) });
              return adminDetail;
            }
          }),
        );
        enrichedAdminDetails = Array.isArray(enrichedAdmins) && enrichedAdmins.length > 0 
          ? enrichedAdmins[0] 
          : enrichedAdmins;
      } else if (organization.adminDetails && !Array.isArray(organization.adminDetails)) {
        enrichedAdminDetails = organization.adminDetails;
      }
      
      if (enrichedAdminDetails) {
        transformed.adminDetails = enrichedAdminDetails;
      }
      
      // Add createdAt
      if (organization.createdAt || organization.createdDate) {
        transformed.createdAt = organization.createdAt || organization.createdDate;
      }
      
      // Add createdBy
      if (organization.createdBy) {
        transformed.createdBy = organization.createdBy;
      }
      
      // Add formAlert
      if (orgRecord.formAlert !== undefined) {
        transformed.formAlert = orgRecord.formAlert;
      }
      
      // Add modifiedBy
      if (organization.modifiedBy) {
        transformed.modifiedBy = organization.modifiedBy;
      }
      
      // Add modifiedDate
      if (organization.modifiedDate) {
        transformed.modifiedDate = organization.modifiedDate;
      }
    } else {
      // Handle ROOT organization
      // Add createdDate
      if (organization.createdAt || organization.createdDate) {
        transformed.createdDate = organization.createdAt || organization.createdDate;
      }
      
      // Add emailAddress
      if (organization.email) {
        transformed.emailAddress = organization.email;
      }
      
      // Add status
      transformed.status = organization.status;
      
      // Add modifiedDate
      if (organization.modifiedDate) {
        transformed.modifiedDate = organization.modifiedDate;
      }
    }
    
    // Build organizationInfo - preserve all existing fields
    if (organization.organizationInfo && typeof organization.organizationInfo === 'object') {
      transformed.organizationInfo = { ...(organization.organizationInfo as Record<string, unknown>) };
      const orgInfo = transformed.organizationInfo as Record<string, unknown>;
      
      // Ensure organizationID exists
      if (!orgInfo.organizationID && organization.organizationId) {
        orgInfo.organizationID = organization.organizationId;
      }
      
      // Ensure organizationType exists
      if (!orgInfo.organizationType && organization.organizationType) {
        orgInfo.organizationType = organization.organizationType;
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
      }
      
      // Add missing fields from organization if not in orgInfo
      if (!orgInfo.phoneNumber && organization.phoneNumber) {
        orgInfo.phoneNumber = organization.phoneNumber;
      }
      if (!orgInfo.organizationName && organization.name) {
        orgInfo.organizationName = organization.name;
      }
      if (!orgInfo.organizationSize && organization.organizationSize) {
        orgInfo.organizationSize = organization.organizationSize;
      }
      if (!orgInfo.phoneCode && organization.phoneCode) {
        orgInfo.phoneCode = organization.phoneCode;
      }
      if (!orgInfo.name && organization.name) {
        orgInfo.name = organization.name;
      }
    } else {
      // Build organizationInfo from flat fields
      const orgInfo: Record<string, unknown> = {
        organizationID: organization.organizationId,
      };
      
      if (organization.organizationType) orgInfo.organizationType = organization.organizationType;
      
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
      
      if (organization.phoneNumber) orgInfo.phoneNumber = organization.phoneNumber;
      if (organization.name) {
        orgInfo.organizationName = organization.name;
        orgInfo.name = organization.name;
      }
      if (organization.organizationSize) orgInfo.organizationSize = organization.organizationSize;
      if (organization.phoneCode) orgInfo.phoneCode = organization.phoneCode;
      
      transformed.organizationInfo = orgInfo;
    }
    
    // Add searchFields for non-ROOT only
    if (!isRootOrg && organization.searchFields && typeof organization.searchFields === 'object') {
      transformed.searchFields = organization.searchFields;
    }
    
    // Add status for non-ROOT
    if (!isRootOrg) {
      transformed.status = organization.status;
    }
    
    // Add traceId for non-ROOT only
    if (!isRootOrg && organization.traceId) {
      transformed.traceId = organization.traceId;
    }
    
    // Add supportedRelations with defaults
    if (orgRecord.supportedRelations !== undefined && orgRecord.supportedRelations !== null) {
      transformed.supportedRelations = orgRecord.supportedRelations;
    } else {
      transformed.supportedRelations = [
        { name: 'Father', id: 'father' },
        { name: 'Mother', id: 'mother' },
        { name: 'Husband', id: 'husband' },
        { name: 'Wife', id: 'wife' },
        { name: 'Son', id: 'son' },
        { name: 'Daughter', id: 'daughter' },
        { name: 'Brother', id: 'brother' },
        { name: 'Sister', id: 'sister' },
        { name: 'Father-in-law', id: 'father-in-law' },
        { name: 'Mother-in-law', id: 'mother-in-law' },
        { name: 'Brother-in-law', id: 'brother-in-law' },
        { name: 'Sister-in-law', id: 'sister-in-law' },
        { name: 'Uncle', id: 'uncle' },
        { name: 'Aunt', id: 'aunt' },
        { name: 'Cousin', id: 'cousin' },
        { name: 'Friend', id: 'friend' },
      ];
    }
    
    // Add linkedOrganizations - fetch dynamically for non-ROOT
    if (!isRootOrg) {
      try {
        const linkedOrgs = await organizationService.getLinkedOrganizations(organizationId, {}, correlationId);
        transformed.linkedOrganizations = linkedOrgs.items || [];
      } catch (err) {
        logger.warn({ event: 'getOrganization_linked_orgs_failed', err: serializeError(err) });
        transformed.linkedOrganizations = [];
      }
    } else {
      transformed.linkedOrganizations = [];
    }

    // Add supportedVitals: merge org-stored vitals (sleep, steps, activity, hydration, etc.) with assigned devices' vitals (legacy: get_vitals_tile_order uses orgDetails.supportedVitals; devices from assigned list)
    if (!isRootOrg) {
      try {
        const authHeader =
          event.headers?.Authorization ||
          event.headers?.authorization ||
          event.headers?.AUTHORIZATION;
        const storedCodes = vitalCodesFromOrgSupportedVitals(organization.supportedVitals);
        logger.info({ event: 'getOrganization_supported_vitals_stored_codes', storedCodes: storedCodes });
        const deviceItems = await fetchOrganizationDevices(organizationId, authHeader, 'organization');
        const getDeviceId = (item: any) => item?.deviceId ?? item?.device_id ?? item?.id;
        const devices = Array.isArray(deviceItems)
          ? deviceItems.filter((item, index, arr) => index === arr.findIndex((x) => getDeviceId(x) === getDeviceId(item)))
          : [];
        const deviceCodes: string[] = [];
        for (const item of devices) {
          const vitals = item?.supportedVitals;
          if (Array.isArray(vitals)) {
            for (const code of vitals) {
              if (typeof code === 'string' && code.trim()) deviceCodes.push(code.trim());
            }
          }
        }
        const allCodes = [...new Set([ ...deviceCodes])];
        transformed.supportedVitals = buildSupportedVitalsArray(allCodes);
        logger.info({ event: 'getOrganization_supported_vitals_success', supportedVitals: transformed.supportedVitals });
      } catch (err) {
        logger.warn({ event: 'getOrganization_supported_vitals_failed', err: serializeError(err) });
        transformed.supportedVitals = [];
      }
    } else {
      transformed.supportedVitals = [];
    }

    // Add mobileScreens - fetch from lambda
    let mobileScreensValue = orgRecord.mobileScreens;
    if (mobileScreensValue === undefined || mobileScreensValue === null) {
      const orgInfoRecord = organization.organizationInfo as Record<string, unknown> | undefined;
      if (orgInfoRecord?.mobileScreens !== undefined && orgInfoRecord.mobileScreens !== null) {
        mobileScreensValue = orgInfoRecord.mobileScreens;
      }
    }
    
    // If mobileScreens is still not found, fetch from lambda
    if ((mobileScreensValue === undefined || mobileScreensValue === null || Object.keys(mobileScreensValue as Record<string, unknown>).length === 0)) {
      try {
        const functionName = process.env.GET_ONBOARDING_SCREENS_LAMBDA || 'dev_global_get_onboarding_screens';
        if (functionName) {
          // Extract locale from headers or default to 'en'
          const locale = event.headers?.['Accept-Language']?.split(',')[0]?.split('-')[0]?.toLowerCase() || 'en';
          
          // Extract userId from authorizer if available
          const authorizer = (event.requestContext as any)?.authorizer;
          const userId = authorizer?.userID || authorizer?.userId;
          
          // Match the lambda's expected format based on the lambda code structure
          const lambdaParams = {
            body: {
              organizationId: organizationId,
              ...(userId && { userId })
            },
            locale: locale
          };
          const lambdaResult = await getMobileScreens(functionName, lambdaParams);
          if (lambdaResult) {
            mobileScreensValue = lambdaResult;
          }
        }
      } catch (err) {
        logger.warn({ event: 'getOrganization_mobile_screens_lambda_failed', err: serializeError(err) });
      }
    }
    
    // Process mobileScreens to add organization info to all screens
    const orgDetails = transformed as Record<string, unknown>;
    const orgInfo = orgDetails?.organizationInfo as Record<string, unknown> | undefined;
    
    // Helper function to add org info to an object
    const addOrgInfoToObject = (obj: Record<string, unknown>) => {
      obj.orgName = orgInfo?.organizationName;
      const hospitalImage = orgInfo?.hospitalImage;
      obj.orgImage = ensureHttps(
        hospitalImage && typeof hospitalImage === 'string' 
          ? hospitalImage 
          : hospitalImage === null 
            ? null 
            : undefined
      );
      
      // Build orgAddress from address fields matching user's format
      const address = orgInfo?.address as Record<string, unknown> | undefined;
      if (address) {
        const addressParts = [
          address.address,
          address.city,
          address.state,
          address.country
        ].filter(Boolean);
        obj.orgAddress = addressParts.length > 0 ? addressParts.join(', ') : undefined;
      }
    };
    
    // Process mobileScreens.screens structure and flatten so response has screen keys directly under mobileScreens (no nested "screens")
    let mobileScreensForResponse: Record<string, unknown> = {};
    if (mobileScreensValue && typeof mobileScreensValue === 'object') {
      const mobileScreensObj = mobileScreensValue as Record<string, unknown>;
      const screens = mobileScreensObj.screens as Record<string, unknown> | undefined;

      if (screens && typeof screens === 'object') {
        // Iterate through all screen types (WELCOME, WALK_THROUGH, PRIVACY_CONSENT, etc.)
        Object.keys(screens).forEach((screenKey) => {
          const screenData = screens[screenKey];

          if (Array.isArray(screenData)) {
            // Handle array screens (like WALK_THROUGH)
            screenData.forEach((item: unknown) => {
              if (item && typeof item === 'object') {
                addOrgInfoToObject(item as Record<string, unknown>);
              }
            });
          } else if (screenData && typeof screenData === 'object') {
            // Handle object screens (like WELCOME, PRIVACY_CONSENT)
            addOrgInfoToObject(screenData as Record<string, unknown>);
          }
        });
        mobileScreensForResponse = screens;
      } else {
        mobileScreensForResponse = mobileScreensObj;
      }
    }
    transformed.mobileScreens = mobileScreensForResponse;
    
    // Add mobileScreen - check both root and organizationInfo
    let mobileScreenValue = orgRecord.mobileScreen;
    if (mobileScreenValue === undefined || mobileScreenValue === null) {
      const orgInfoRecord = organization.organizationInfo as Record<string, unknown> | undefined;
      if (orgInfoRecord?.mobileScreen !== undefined && orgInfoRecord.mobileScreen !== null) {
        mobileScreenValue = orgInfoRecord.mobileScreen;
      }
    }
    
    // Process mobileScreen to add organization info to all screens
    if (mobileScreenValue && typeof mobileScreenValue === 'object') {
      const mobileScreenObj = mobileScreenValue as Record<string, unknown>;
      
      // Check if mobileScreen has items array
      if (Array.isArray(mobileScreenObj.items)) {
        mobileScreenObj.items = mobileScreenObj.items.map((item: unknown) => {
          if (item && typeof item === 'object') {
            const itemObj = item as Record<string, unknown>;
            // Ensure attributes object exists
            if (!itemObj.attributes || typeof itemObj.attributes !== 'object') {
              itemObj.attributes = {};
            }
            const attributes = itemObj.attributes as Record<string, unknown>;
            
            // Add organization info to attributes matching user's format
            attributes.orgName = orgInfo?.organizationName;
            const hospitalImage = orgInfo?.hospitalImage;
            attributes.orgImage = ensureHttps(
              hospitalImage && typeof hospitalImage === 'string' 
                ? hospitalImage 
                : hospitalImage === null 
                  ? null 
                  : undefined
            );
            
            // Build orgAddress from address fields matching user's format
            const address = orgInfo?.address as Record<string, unknown> | undefined;
            if (address) {
              const addressParts = [
                address.address,
                address.city,
                address.state,
                address.country
              ].filter(Boolean);
              attributes.orgAddress = addressParts.length > 0 ? addressParts.join(', ') : undefined;
            }
          }
          return item;
        });
      }
    }
    
    transformed.mobileScreen = mobileScreenValue !== undefined && mobileScreenValue !== null ? mobileScreenValue : {};
    
    // Add features
    if (orgRecord.features !== undefined && orgRecord.features !== null) {
      transformed.features = orgRecord.features;
    } else {
      transformed.features = [];
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
