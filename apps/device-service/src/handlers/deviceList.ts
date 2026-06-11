import { withApiHandler } from '@api-hub/middleware';
import { Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { DeviceService } from '../services/deviceService';
import { GlobalDeviceRepository } from '../repositories/globalDeviceRepository';
import { OrgDeviceRepository } from '../repositories/orgDeviceRepository';
import { RecommendationRepository } from '../repositories/recommendationRepository';
import { deviceListSchema } from '../validation/device.validation';
import { getAuthorizerOrganizationId, resolveDeviceListUserId } from '../utils/helpers';
import { PATHS } from '../constants/paths';
import { HTTP_METHODS } from '../constants/httpMethods';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceService = new DeviceService();
const globalDeviceRepository = new GlobalDeviceRepository();
const orgDeviceRepository = new OrgDeviceRepository();
const recommendationRepository = new RecommendationRepository();

const normalizeFilterValue = (value?: string): string => (value || '').trim().toUpperCase();

/** Org device rows from ORG_DEVICES# partition: only latest assignment sync (isActive true). Legacy rows without isActive are treated as active. */
const isActiveOrgDeviceAssignment = (d: { isActive?: boolean }): boolean => d.isActive !== false;

const applyListFilters = (devices: any[], category?: string, searchValue?: string): any[] => {
  let filteredDevices = devices;
  const normalizedCategory = normalizeFilterValue(category);
  const normalizedSearchValue = (searchValue || '').trim().toLowerCase();

  if (normalizedCategory && normalizedCategory !== 'ALL') {
    filteredDevices = filteredDevices.filter(
      (device) => normalizeFilterValue(device.category) === normalizedCategory,
    );
  }

  if (normalizedSearchValue && normalizedSearchValue !== 'all') {
    filteredDevices = filteredDevices.filter((device) => {
      const searchableFields = [device.displayName, device.name, device.deviceId, device.category];
      return searchableFields.some((field) =>
        String(field || '').toLowerCase().includes(normalizedSearchValue),
      );
    });
  }

  return filteredDevices;
};

const toSyncCategory = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
};

const mapCatalogDevice = (device: Record<string, unknown>) => ({
  category: device.category,
  deviceId: device.deviceId,
  deviceImage: device.deviceImage || '',
  displayName: device.displayName || device.name,
  countriesSupported: device.countriesSupported || [],
  manufacturerImage: device.manufacturerImage || '',
  manufacturerName: device.manufacturerName || '',
  name: device.name,
  template: device.template || 1,
  deviceDetails: device.deviceDetails || '',
  supportedVitals: device.supportedVitals || [],
  syncCategory: toSyncCategory(device.syncCategory),
});

const deviceListImpl: any = async (req: any, context?: Context) => {
  const evt = req.event ?? req;
  const startTime = Date.now();
  const correlationId = req.context?.correlationId ?? extractCorrelationId(evt);
  const awsRequestId = req.context?.awsRequestId ?? (context ? extractAwsRequestId(context) : undefined);
  const httpMethod = evt.httpMethod || HTTP_METHODS.POST;
  const path = evt.path || PATHS.DEVICES_LIST;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceList_received' });

  try {
    let requestData: any = {};
    if (req.body && typeof req.body === 'object') {
      requestData = req.body;
      logger.info({ event: 'deviceList_post_body', action: requestData.action });

      const validation = deviceListSchema.safeParse(requestData);
      if (!validation.success) {
        logger.error({ event: 'deviceList_validation_error', errors: validation.error.issues });
        return ApiResponse.badRequest('DEVICE.INVALID_REQUEST_DATA', { correlationId, event: evt });
      }
    } else if (evt.body && httpMethod === HTTP_METHODS.POST) {
      requestData = typeof evt.body === 'string' ? JSON.parse(evt.body) : evt.body;
      logger.info({ event: 'deviceList_post_body', action: requestData.action });

      const validation = deviceListSchema.safeParse(requestData);
      if (!validation.success) {
        logger.error({ event: 'deviceList_validation_error', errors: validation.error.issues });
        return ApiResponse.badRequest('DEVICE.INVALID_REQUEST_DATA', { correlationId, event: evt });
      }
    } else {
      requestData = evt.queryStringParameters || {};
    }

    const organizationID =
      requestData.organizationID ||
      requestData.organizationId ||
      getAuthorizerOrganizationId(evt) ||
      req.context?.userContext?.organizationId;
    const userIdForDeviceList =
      resolveDeviceListUserId(evt, requestData) ||
      req.context?.userContext?.userId;
    const { action, category, searchValue, deviceId, deviceType, countryCode, patientUserId } = requestData;
    
    logger.info({ 
      event: 'deviceList_parsed_params', 
      action, 
      category,
      searchValue,
      organizationID,
      userIdForDeviceList,
      hasOrganizationId: !!requestData.organizationId,
      hasOrganizationID: !!requestData.organizationID,
      hasBodyUserId: !!(requestData.userId || requestData.userID),
    });
    // Scenario 1: Return only device category names
    if (action?.toLowerCase() === 'devicecategory') {
      logger.info({ event: 'deviceList_category_names' });
      
      // Get all devices from DynamoDB
      const allDevices = await globalDeviceRepository.getDevicesByCategory();
      
      // Extract unique category names from enabled devices
      const categoryNamesSet = new Set<string>();
      allDevices.forEach((device: any) => {
        if (device.enabled && device.category) {
          categoryNamesSet.add(device.category);
        }
      });
      
      // Convert Set to sorted array
      const categoryNames = Array.from(categoryNamesSet).sort();
      
      const duration = Date.now() - startTime;
      logHttpRequest(logger, httpMethod, path, 200, duration, correlationId);
      return ApiResponse.ok(
        { items: categoryNames },
        'DEVICE.DEVICE_CATEGORY_SUCCESS',
        { correlationId, event: evt }
      );
    }

    // Scenario 2: Return devices for organization (ROOT or specific org)
    if (action?.toLowerCase() === 'organization' && organizationID) {
      logger.info({ event: 'deviceList_organization', organizationID, category, searchValue });
      
      // Get all devices from DynamoDB
      let allDevices = await globalDeviceRepository.getDevicesByOrganization(organizationID);
      
      // Filter enabled devices; for org-specific catalogs, only rows from the latest assign (isActive !== false)
      allDevices = allDevices.filter((d) => d.enabled === true);
      if (organizationID.toUpperCase() !== 'ROOT') {
        allDevices = allDevices.filter((d) => isActiveOrgDeviceAssignment(d));
      }
      
      // Apply country filter if provided
      if (countryCode) {
        allDevices = allDevices.filter((d) => 
          d.countriesSupported && d.countriesSupported.includes(countryCode)
        );
      }

      // Apply category/search filters
      allDevices = applyListFilters(allDevices, category, searchValue);
      
      // Map devices to the requested response format
      const deviceList = allDevices.map((device: any) => mapCatalogDevice(device));

      const duration = Date.now() - startTime;
      logHttpRequest(logger, httpMethod, path, 200, duration, correlationId);
      return ApiResponse.ok(
        { items: deviceList },
        'DEVICE.DEVICE_LIST_SUCCESS',
        { correlationId, event: evt }
      );
    }

    // Scenario 3: Return devices for a specific organization (patient action)
    if (action?.toLowerCase() === 'patient' && organizationID) {
      logger.info({ event: 'deviceList_patient', organizationID, category, searchValue });
      
      // Get organization-specific devices from DynamoDB
      const orgDevices = await orgDeviceRepository.getOrgDevices(organizationID);
      logger.info({ event: 'deviceList_patient_raw_count', count: orgDevices.length });
      
      // Filter enabled, active org assignments (isActive !== false)
      let enabledDevices = orgDevices.filter((d) => d.enabled === true);
      enabledDevices = enabledDevices.filter((d) => isActiveOrgDeviceAssignment(d));
      enabledDevices = applyListFilters(enabledDevices, category, searchValue);
      logger.info({ event: 'deviceList_patient_enabled_count', count: enabledDevices.length });
      
      // Map devices to the requested response format
      const deviceList = enabledDevices.map((device: any) => mapCatalogDevice(device));
      
      logger.info({ event: 'deviceList_patient_final_count', count: deviceList.length });
      const duration = Date.now() - startTime;
      logHttpRequest(logger, httpMethod, path, 200, duration, correlationId);
      return ApiResponse.ok(
        { items: deviceList },
        'DEVICE.DEVICE_LIST_SUCCESS',
        { correlationId, event: evt }
      );
    }

    // Scenario 4: Return recommended devices for a patient
    if (action?.toLowerCase() === 'recommend' && patientUserId) {
      logger.info({ event: 'deviceList_recommend', patientUserId });
      
      // Get patient recommendations from DynamoDB
      const recommendations = await recommendationRepository.getPatientRecommendations(patientUserId);
      logger.info({ event: 'deviceList_recommend_raw_count', count: recommendations.length });
      
      // Get all global devices to enrich recommendation data
      const allGlobalDevices = await globalDeviceRepository.getDevicesByCategory();
      const deviceMap = new Map(allGlobalDevices.map(d => [d.deviceId, d]));
      
      // Map recommendations to device format with full device details
      const deviceList = recommendations.map((recommendation: any) => {
        // Try to get full device details from global repository
        const globalDevice = deviceMap.get(recommendation.deviceId);
        const referredBy = recommendation.doctorData?.doctorName || '';
        const referredOn = recommendation.doctorData?.recommendTime;
        return {
          category: recommendation.category || globalDevice?.category,
          deviceId: recommendation.deviceId,
          deviceImage: recommendation.deviceImage || globalDevice?.deviceImage || '',
          displayName: recommendation.displayName || recommendation.name || globalDevice?.displayName || globalDevice?.name,
          countriesSupported: recommendation.countriesSupported || globalDevice?.countriesSupported || [],
          manufacturerImage: recommendation.manufacturerImage || globalDevice?.manufacturerImage || '',
          manufacturerName: recommendation.manufacturerName || globalDevice?.manufacturerName || '',
          name: recommendation.name || globalDevice?.name,
          template: recommendation.template || globalDevice?.template || 1,
          deviceDetails: recommendation.deviceDetails || globalDevice?.deviceDetails || '',
          supportedVitals: recommendation.supportedVitals || globalDevice?.supportedVitals || [],
          syncCategory: toSyncCategory(recommendation.syncCategory ?? globalDevice?.syncCategory),
          status: recommendation.status, // Include recommendation status (UNPAIRED/PAIRED)
          doctorData: recommendation.doctorData, // Include doctor information
          referredBy: referredBy,
          referredOn: referredOn,
        };
      });
      
      logger.info({ event: 'deviceList_recommend_final_count', count: deviceList.length });
      const duration = Date.now() - startTime;
      logHttpRequest(logger, httpMethod, path, 200, duration, correlationId);
      return ApiResponse.ok(
        { items: deviceList },
        'DEVICE.DEVICE_LIST_SUCCESS',
        { correlationId, event: evt }
      );
    }

    // Scenario 5: User paired devices (DEVICE_LIST#userId) — legacy retrieve-device-list path.
    // syncCategory and other pairing fields live only on these rows, not the global catalog.
    if (userIdForDeviceList) {
      logger.info({ event: 'deviceList_user_devices', userId: userIdForDeviceList });
      const devices = await deviceService.getUserDevices(userIdForDeviceList, {
        deviceId,
        deviceType,
      });
      const duration = Date.now() - startTime;
      logHttpRequest(logger, httpMethod, path, 200, duration, correlationId);
      return ApiResponse.ok(devices, 'DEVICE.DEVICE_LIST_RETRIEVED_SUCCESS', { correlationId, event: evt });
    }

    // Default: Return all global devices (backward compatibility)
    logger.info({ event: 'deviceList_all_devices' });
    let allDevices = await globalDeviceRepository.getDevicesByCategory();
    
    // Filter to only return enabled devices
    allDevices = allDevices.filter((d) => d.enabled === true);
    
    // Apply optional filters if provided
    if (deviceId) {
      allDevices = allDevices.filter((d) => d.deviceId === deviceId);
    }
    if (deviceType) {
      allDevices = allDevices.filter((d) => d.category === deviceType);
    }
    
    const duration = Date.now() - startTime;
    logHttpRequest(logger, httpMethod, path, 200, duration, correlationId);
    return  ApiResponse.ok(allDevices, 'DEVICE.DEVICE_LIST_RETRIEVED_SUCCESS', { correlationId, event: evt });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceList_error', err: serializeError(err) });
    logHttpRequest(logger, httpMethod, path, 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.LIST_RETRIEVAL_FAILED', { correlationId, event: evt }, { code: 'LIST_RETRIEVAL_FAILED' });
  }
};

export const handler = withApiHandler(
  { operation: 'device.list', useLegacyResponseFormat: true},
  deviceListImpl,
);
