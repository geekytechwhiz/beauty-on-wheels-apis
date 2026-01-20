import { OrgDeviceRepository } from '../repositories/orgDeviceRepository';
import { RecommendationRepository } from '../repositories/recommendationRepository';
import { GlobalDeviceRepository } from '../repositories/globalDeviceRepository';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { OrgDevice, DeviceRecommendation, GlobalDevice } from '../models';

const baseLogger = createLogger({ service: 'device-search-service', redactPII: true });

export class DeviceSearchService {
  private orgDeviceRepository: OrgDeviceRepository;
  private recommendationRepository: RecommendationRepository;
  private globalDeviceRepository: GlobalDeviceRepository;

  constructor() {
    this.orgDeviceRepository = new OrgDeviceRepository();
    this.recommendationRepository = new RecommendationRepository();
    this.globalDeviceRepository = new GlobalDeviceRepository();
  }

  /**
   * Get organization devices (for ROOT organization)
   */
  async getOrganizationDevices(organizationId: string, countryCode?: string): Promise<GlobalDevice[]> {
    const logger = createChildLogger(baseLogger, { organizationId });
    logger.info({ event: 'service_getOrganizationDevices_start' });

    // Get devices from global device list
    const devices = await this.globalDeviceRepository.getDevicesByCategory(undefined, countryCode);
    logger.info({ event: 'service_getOrganizationDevices_success', count: devices.length });
    return devices;
  }

  /**
   * Get patient devices (for doctor viewing devices to recommend)
   */
  async getPatientDevices(organizationId: string, countryCode?: string): Promise<GlobalDevice[]> {
    // Same as organization devices - returns available devices for recommendation
    return this.getOrganizationDevices(organizationId, countryCode);
  }

  /**
   * Get recommended devices
   */
  async getRecommendedDevices(userId?: string, patientUserId?: string): Promise<DeviceRecommendation[]> {
    const logger = createChildLogger(baseLogger, { userId, patientUserId });
    logger.info({ event: 'service_getRecommendedDevices_start' });

    // If patientUserId is provided, get patient's recommendations (doctor viewing patient)
    // Otherwise, get user's own recommendations
    const targetUserId = patientUserId || userId;
    if (!targetUserId) {
      return [];
    }

    const recommendations = await this.recommendationRepository.getPatientRecommendations(targetUserId);
    logger.info({ event: 'service_getRecommendedDevices_success', count: recommendations.length });
    return recommendations;
  }

  /**
   * Get device categories
   */
  async getDeviceCategories(): Promise<string[]> {
    const logger = createChildLogger(baseLogger);
    logger.info({ event: 'service_getDeviceCategories_start' });

    const categories = await this.globalDeviceRepository.getCategories();
    logger.info({ event: 'service_getDeviceCategories_success', count: categories.length });
    return categories;
  }
}
