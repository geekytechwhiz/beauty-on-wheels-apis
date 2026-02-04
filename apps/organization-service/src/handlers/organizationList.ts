import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'organizationList_received' });

  if ((event.httpMethod || '').toUpperCase() !== 'POST') {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/organization/list', 405, duration, correlationId);
    return ApiResponse.badRequest(
      { title: 'Invalid request', description: 'Only POST method is allowed' },
      { requestId: correlationId },
      { code: 'METHOD_NOT_ALLOWED' },
    );
  }

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    let organizationId = body?.organizationId ?? (event as { organizationID?: string })?.organizationID;
    if (organizationId === 'ROOT') {
      organizationId = undefined;
    }

    const statusRaw = body?.status;
    const organizationTypeRaw = body?.organizationType;
    const assignedPackagesNameRaw = body?.assignedPackagesName;

    const toArray = (value: unknown): string[] | undefined => {
      if (!value) return undefined;
      if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
      if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
      return undefined;
    };

    const limitRaw = body?.limit;
    const limit = typeof limitRaw === 'string' ? Number(limitRaw) : typeof limitRaw === 'number' ? limitRaw : undefined;

    const nextPaginationKey = body?.nextPaginationKey;

    const result = await organizationService.listOrganizations({
      organizationId,
      status: toArray(statusRaw),
      organizationType: toArray(organizationTypeRaw),
      adminName: body?.adminName,
      organizationName: body?.organizationName,
      country: body?.country,
      state: body?.state,
      city: body?.city,
      assignedPackagesName: toArray(assignedPackagesNameRaw),
      limit: Number.isFinite(limit) ? limit : undefined,
      nextPaginationKey: typeof nextPaginationKey === 'string' ? nextPaginationKey : undefined,
    });

    const organizations = result.items.map((item) => {
      const transformed: Record<string, unknown> = {};
      
      // Build organizationInfo
      if (item.organizationInfo && typeof item.organizationInfo === 'object') {
        // Use existing organizationInfo and preserve all existing fields
        transformed.organizationInfo = { ...(item.organizationInfo as Record<string, unknown>) };
        const orgInfo = transformed.organizationInfo as Record<string, unknown>;
        
        // Ensure name field exists (use organizationName if name doesn't exist)
        if (orgInfo.organizationName && !orgInfo.name) {
          orgInfo.name = orgInfo.organizationName;
        }
        
        // Ensure organizationID exists
        if (!orgInfo.organizationID && item.organizationId) {
          orgInfo.organizationID = item.organizationId;
        }
        
        // Ensure address structure is correct - preserve existing or build from flat fields
        if (!orgInfo.address || typeof orgInfo.address !== 'object') {
          const addressObj: Record<string, unknown> = {};
          if (item.country) addressObj.country = item.country;
          if (item.address) addressObj.address = item.address;
          if (item.state) addressObj.state = item.state;
          if (item.city) addressObj.city = item.city;
          if (item.postalCode) addressObj.postalCode = item.postalCode;
          if (item.countryCode) addressObj.countryCode = item.countryCode;
          
          // Only add address if it has at least one field
          if (Object.keys(addressObj).length > 0) {
            orgInfo.address = addressObj;
          }
        } else {
          // Address exists, ensure it has all available fields from item
          const existingAddress = orgInfo.address as Record<string, unknown>;
          if (item.country && !existingAddress.country) existingAddress.country = item.country;
          if (item.address && !existingAddress.address) existingAddress.address = item.address;
          if (item.state && !existingAddress.state) existingAddress.state = item.state;
          if (item.city && !existingAddress.city) existingAddress.city = item.city;
          if (item.postalCode && !existingAddress.postalCode) existingAddress.postalCode = item.postalCode;
          if (item.countryCode && !existingAddress.countryCode) existingAddress.countryCode = item.countryCode;
        }
        
        // Add missing fields from item if not already in orgInfo (only if they exist)
        if (!orgInfo.organizationName && item.name) {
          orgInfo.organizationName = item.name;
        }
        if (!orgInfo.name && item.name) {
          orgInfo.name = item.name;
        }
        if (!orgInfo.organizationType && item.organizationType) {
          orgInfo.organizationType = item.organizationType;
        }
        if (!orgInfo.phoneCode && item.phoneCode) {
          orgInfo.phoneCode = item.phoneCode;
        }
        if (!orgInfo.phoneNumber && item.phoneNumber) {
          orgInfo.phoneNumber = item.phoneNumber;
        }
        if (!orgInfo.emailAddress && item.email) {
          orgInfo.emailAddress = item.email;
        }
        if (!orgInfo.hospitalBio && item.hospitalBio !== undefined) {
          orgInfo.hospitalBio = item.hospitalBio;
        }
        if (!orgInfo.hospitalImage && item.hospitalImage) {
          orgInfo.hospitalImage = item.hospitalImage;
        }
      } else {
        // Build organizationInfo from flat fields
        const orgInfo: Record<string, unknown> = {
          organizationID: item.organizationId,
          organizationName: item.name,
          name: item.name,
        };
        
        if (item.organizationType) orgInfo.organizationType = item.organizationType;
        if (item.phoneCode) orgInfo.phoneCode = item.phoneCode;
        if (item.phoneNumber) orgInfo.phoneNumber = item.phoneNumber;
        if (item.email) orgInfo.emailAddress = item.email;
        if (item.hospitalBio !== undefined) orgInfo.hospitalBio = item.hospitalBio;
        if (item.hospitalImage) orgInfo.hospitalImage = item.hospitalImage;
        
        // Build address object
        const addressObj: Record<string, unknown> = {};
        if (item.country) addressObj.country = item.country;
        if (item.address) addressObj.address = item.address;
        if (item.state) addressObj.state = item.state;
        if (item.city) addressObj.city = item.city;
        if (item.postalCode) addressObj.postalCode = item.postalCode;
        if (item.countryCode) addressObj.countryCode = item.countryCode;
        
        if (Object.keys(addressObj).length > 0) {
          orgInfo.address = addressObj;
        }
        
        transformed.organizationInfo = orgInfo;
      }
      
      // Add status (required)
      transformed.status = item.status;
      
      // Add adminDetails only if it exists (use first item if array)
      if (item.adminDetails) {
        if (Array.isArray(item.adminDetails) && item.adminDetails.length > 0) {
          transformed.adminDetails = item.adminDetails[0];
        } else if (!Array.isArray(item.adminDetails)) {
          transformed.adminDetails = item.adminDetails;
        }
      }
      
      // Add createdAt only if it exists
      if (item.createdAt || item.createdDate) {
        transformed.createdAt = item.createdAt || item.createdDate;
      }
      
      // Add formAlert only if it exists
      const itemRecord = item as unknown as Record<string, unknown>;
      if (itemRecord.formAlert !== undefined) {
        transformed.formAlert = itemRecord.formAlert;
      }
      
      // Add searchFields only if it exists
      if (item.searchFields && typeof item.searchFields === 'object') {
        transformed.searchFields = item.searchFields;
      }
      
      return transformed;
    });
    
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/organization/list', 200, duration, correlationId);
    return ApiResponse.ok(
      { items: organizations },
      { title: 'Organization list success', description: 'The organization list completed successfully.' },
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'organizationList_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/organization/list', 500, duration, correlationId);
    return ApiResponse.internalServerError(
      { title: 'Failed to list organizations', description: (err as Error)?.message || 'Unknown error' },
      { requestId: correlationId },
      { code: 'LIST_ORGANIZATIONS_FAILED' },
    );
  }
};
