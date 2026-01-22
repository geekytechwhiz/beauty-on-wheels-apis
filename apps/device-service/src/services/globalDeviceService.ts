import { GlobalDeviceRepository } from '../repositories/globalDeviceRepository';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { GlobalDevice } from '../models';

const baseLogger = createLogger({ service: 'global-device-service' });

export class GlobalDeviceService {
  private globalDeviceRepository: GlobalDeviceRepository;

  constructor() {
    this.globalDeviceRepository = new GlobalDeviceRepository();
  }

  /**
   * Register a device to the global device list (root level registration)
   * Access Pattern:
   * pk: DEVICE_LIST
   * sk: CATEGORY#${category}#${deviceId}
   * sk3: ${deviceId.toUpperCase().split(' ').join('_')}
   * sk4: ${category.toUpperCase()}
   */
  async registerDevice(
    data: {
      deviceId: string;
      category: string;
      name: string;
      enabled?: boolean;
      countriesSupported?: string[];
      [key: string]: unknown;
    },
    correlationId?: string,
  ): Promise<GlobalDevice> {
    const logger = createChildLogger(baseLogger, { correlationId, deviceId: data.deviceId, category: data.category });
    logger.info({ event: 'service_registerGlobalDevice_start' });

    try {
      // Check if device already exists
      const existing = await this.globalDeviceRepository.getDeviceById(data.deviceId);
      if (existing) {
        logger.warn({ event: 'global_device_already_exists', deviceId: data.deviceId });
        // Update the existing device with new data
        return await this.globalDeviceRepository.createGlobalDevice(data);
      }

      // Create new global device entry
      const globalDevice = await this.globalDeviceRepository.createGlobalDevice(data);
      logger.info({ event: 'global_device_registered', deviceId: data.deviceId });

      return globalDevice;
    } catch (err) {
      logger.error({ event: 'service_registerGlobalDevice_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Register multiple devices to the global device list
   */
  async registerMultipleDevices(
    devices: Array<{
      deviceId: string;
      category: string;
      name: string;
      enabled?: boolean;
      countriesSupported?: string[];
      [key: string]: unknown;
    }>,
    correlationId?: string,
  ): Promise<GlobalDevice[]> {
    const logger = createChildLogger(baseLogger, { correlationId, count: devices.length });
    logger.info({ event: 'service_registerMultipleGlobalDevices_start' });

    try {
      const results = await Promise.all(
        devices.map((device) => this.registerDevice(device, correlationId)),
      );

      logger.info({ event: 'service_registerMultipleGlobalDevices_success', count: results.length });
      return results;
    } catch (err) {
      logger.error({ event: 'service_registerMultipleGlobalDevices_error', err: serializeError(err) });
      throw err;
    }
  }
}
