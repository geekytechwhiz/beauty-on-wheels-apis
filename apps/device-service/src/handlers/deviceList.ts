import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { DeviceService } from '../services/deviceService';
import { GlobalDeviceRepository } from '../repositories/globalDeviceRepository';
import { OrgDeviceRepository } from '../repositories/orgDeviceRepository';
import { RecommendationRepository } from '../repositories/recommendationRepository';
import { deviceListSchema } from '../validation/device.validation';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceService = new DeviceService();
const globalDeviceRepository = new GlobalDeviceRepository();
const orgDeviceRepository = new OrgDeviceRepository();
const recommendationRepository = new RecommendationRepository();

export const handler: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceList_received' });

  try {
    // Parse request body for POST requests
    let requestData: any = {};
    
    if (event.httpMethod === 'POST' && event.body) {
      requestData = JSON.parse(event.body);
      logger.info({ event: 'deviceList_post_body', action: requestData.action });
      
      // Validate request data
      const validation = deviceListSchema.safeParse(requestData);
      if (!validation.success) {
        logger.error({ event: 'deviceList_validation_error', errors: validation.error.issues });
        return ApiResponse.badRequest('DEVICE.INVALID_REQUEST_DATA', { requestId: correlationId, event });
      }
    } else {
      // For GET requests, use query parameters (backward compatibility)
      requestData = event.queryStringParameters || {};
    }

    // Handle both organizationID and organizationId for flexibility
    const organizationID = requestData.organizationID || requestData.organizationId;
    const { action, searchValue, deviceId, deviceType, userId, countryCode, patientUserId } = requestData;
    
    logger.info({ 
      event: 'deviceList_parsed_params', 
      action, 
      organizationID,
      hasOrganizationId: !!requestData.organizationId,
      hasOrganizationID: !!requestData.organizationID
    });

    // Scenario 1: Return only device category names
    if (action === 'deviceCategory') {
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
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/list', 200, duration, correlationId);
      return ApiResponse.ok(
        { items: categoryNames },
        {
          title: 'Device category success',
          description: 'The device category completed successfully.',
        },
        { requestId: correlationId, event }
      );
    }

    // Scenario 2: Return devices for organization (ROOT or specific org)
    if (action === 'organization' && organizationID) {
      logger.info({ event: 'deviceList_organization', organizationID, searchValue });
      
      // Get all devices from DynamoDB
      let allDevices = await globalDeviceRepository.getDevicesByCategory();
      
      // Filter enabled devices
      allDevices = allDevices.filter((d) => d.enabled === true);
      
      // Apply country filter if provided
      if (countryCode) {
        allDevices = allDevices.filter((d) => 
          d.countriesSupported && d.countriesSupported.includes(countryCode)
        );
      }
      
      // Map devices to the requested response format
      const deviceList = allDevices.map((device: any) => ({
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
      }));
      
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/list', 200, duration, correlationId);
      return ApiResponse.ok(
        { items: deviceList },
        {
          title: 'Device list success',
          description: 'The device list completed successfully.',
        },
        { requestId: correlationId, event }
      );
    }

    // Scenario 3: Return devices for a specific organization (patient action)
    if (action === 'patient' && organizationID) {
      logger.info({ event: 'deviceList_patient', organizationID });
      
      // Get organization-specific devices from DynamoDB
      const orgDevices = await orgDeviceRepository.getOrgDevices(organizationID);
      logger.info({ event: 'deviceList_patient_raw_count', count: orgDevices.length });
      
      // Filter enabled devices
      const enabledDevices = orgDevices.filter((d) => d.enabled === true);
      logger.info({ event: 'deviceList_patient_enabled_count', count: enabledDevices.length });
      
      // Map devices to the requested response format
      const deviceList = enabledDevices.map((device: any) => ({
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
      }));
      
      logger.info({ event: 'deviceList_patient_final_count', count: deviceList.length });
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/list', 200, duration, correlationId);
      return ApiResponse.ok(
        { items: deviceList },
        {
          title: 'Device list success',
          description: 'The device list completed successfully.',
        },
        { requestId: correlationId, event }
      );
    }

    // Scenario 4: Return recommended devices for a patient
    if (action === 'recommend' && patientUserId) {
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
        const referredBy = recommendation.doctorData?.doctorId || recommendation.doctorData?.doctorName || undefined;
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
          status: recommendation.status, // Include recommendation status (UNPAIRED/PAIRED)
          doctorData: recommendation.doctorData, // Include doctor information
          referredBy: referredBy,
          referredOn: referredOn,
        };
      });
      
      logger.info({ event: 'deviceList_recommend_final_count', count: deviceList.length });
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/list', 200, duration, correlationId);
      return ApiResponse.ok(
        { items: deviceList },
        {
          title: 'Device list success',
          description: 'The device list completed successfully.',
        },
        { requestId: correlationId, event }
      );
    }

    // Scenario 5: Return user-specific devices (backward compatibility)
    const userIdFromAuth = (event.requestContext as any)?.authorizer?.userID || 
                          (event.requestContext as any)?.authorizer?.userId || 
                          userId;
    
    if (userIdFromAuth) {
      logger.info({ event: 'deviceList_user_devices', userId: userIdFromAuth });
      const devices = await deviceService.getUserDevices(userIdFromAuth, {
        deviceId,
        deviceType,
      });
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/devices/list', 200, duration, correlationId);
      return ApiResponse.ok(devices, 'DEVICE.DEVICE_LIST_RETRIEVED_SUCCESS', { requestId: correlationId, event });
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
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/devices/list', 200, duration, correlationId);
    return ApiResponse.ok(allDevices, 'DEVICE.DEVICE_LIST_RETRIEVED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceList_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/devices/list', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.LIST_RETRIEVAL_FAILED', { requestId: correlationId, event }, { code: 'LIST_RETRIEVAL_FAILED' });
  }
};
