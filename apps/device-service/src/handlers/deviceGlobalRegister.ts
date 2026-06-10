import { withApiHandler } from '@api-hub/middleware';
import { Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { GlobalDeviceService } from '../services/globalDeviceService';
import devicesData from '../utils/devices.json';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const globalDeviceService = new GlobalDeviceService();

interface DeviceJson {
  categories: Array<{
    categoryName: string;
    category: number;
    categoryEnabled: boolean;
    manufacturers: Array<{
      manufacturerName: string;
      enabled: boolean;
      devices: Array<{
        name: string;
        deviceId: string;
        category: number;
        enabled?: boolean;
        countriesSupported?: string[];
        [key: string]: unknown;
      }>;
    }>;
  }>;
}

/**
 * Extract and flatten all devices from the devices.json structure
 */
function extractDevicesFromJson(data: DeviceJson): Array<{
  deviceId: string;
  category: string;
  name: string;
  enabled?: boolean;
  countriesSupported?: string[];
  [key: string]: unknown;
}> {
  const devices: Array<{
    deviceId: string;
    category: string;
    name: string;
    enabled?: boolean;
    countriesSupported?: string[];
    [key: string]: unknown;
  }> = [];

  for (const categoryData of data.categories) {
    if (!categoryData.categoryEnabled) {
      continue; // Skip disabled categories
    }

    for (const manufacturer of categoryData.manufacturers) {
      if (!manufacturer.enabled) {
        continue; // Skip disabled manufacturers
      }

      for (const device of manufacturer.devices) {
        if (device.enabled === false) {
          continue; // Skip disabled devices
        }

        // Use categoryName as the category string (not the number)
        devices.push({
          deviceId: device.deviceId,
          category: categoryData.categoryName,
          name: device.name,
          enabled: device.enabled !== undefined ? device.enabled : true,
          countriesSupported: device.countriesSupported || [],
          // Include all other device properties
          ...Object.fromEntries(
            Object.entries(device).filter(([key]) => 
              !['deviceId', 'category', 'name', 'enabled', 'countriesSupported'].includes(key)
            )
          ),
        });
      }
    }
  }

  return devices;
}

const deviceGlobalRegisterImpl: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceGlobalRegister_received' });

  try {
    // Read and parse devices from JSON file
    const devicesJson = devicesData as unknown as DeviceJson;
    
    // Extract all devices from the nested structure
    const devices = extractDevicesFromJson(devicesJson);
    
    if (devices.length === 0) {
      logger.warn({ event: 'deviceGlobalRegister_no_devices_found' });
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/global/register', 200, duration, correlationId);
      return ApiResponse.ok([], 'DEVICE.NO_DEVICES_FOUND', {  correlationId: correlationId, event });
    }

    logger.info({ event: 'deviceGlobalRegister_devices_extracted', count: devices.length });

    // Register all devices
    const results = await globalDeviceService.registerMultipleDevices(devices, correlationId);

    const response = results.map((device) => ({
      message: 'Device successfully registered to global device list',
      statusCode: 201,
      deviceId: device.deviceId,
      category: device.category,
      name: device.name,
    }));

    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/global/register', 201, duration, correlationId);
    return ApiResponse.created(response, 'DEVICE.GLOBAL_DEVICE_REGISTERED_SUCCESS', {  correlationId: correlationId, event });
  } catch (err) {
    logger.error({ event: 'deviceGlobalRegister_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/global/register', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.GLOBAL_REGISTRATION_FAILED', {  correlationId: correlationId, event }, { code: 'REGISTRATION_FAILED' });
  }
};

export const handler = withApiHandler({   useLegacyResponseFormat: true, operation: 'device.globalRegister' }, deviceGlobalRegisterImpl);
