import { RecommendationRepository } from '../repositories/recommendationRepository';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { DeviceRecommendation } from '../models';
import { RecommendationNotFoundError, RecommendationAlreadyExistsError, RecommendationCannotRemovePairedError } from '../utils/errors';
import { publishEvent } from '../events/event.publisher';
import { publishRecommendationNotification } from './notification.service';

const baseLogger = createLogger({ service: 'recommendation-service', redactPII: true });

export class RecommendationService {
  private repository: RecommendationRepository;

  constructor() {
    this.repository = new RecommendationRepository();
  }

  /**
   * Add device recommendations for a patient
   */
  async recommendDevices(
    patientUserId: string,
    doctorId: string,
    doctorName: string,
    organizationId: string,
    devices: Array<{ deviceId: string; category: string; name: string }>,
    correlationId?: string,
  ): Promise<void> {
    const logger = createChildLogger(baseLogger, { correlationId, patientUserId, doctorId, count: devices.length });
    logger.info({ event: 'service_recommendDevices_start' });

    // Check for existing recommendations and create new ones
    await Promise.all(
      devices.map(async (device) => {
        const existing = await this.repository.getRecommendation(patientUserId, device.deviceId);
        if (existing) {
          logger.warn({ event: 'recommendation_already_exists', deviceId: device.deviceId });
          // Don't throw - just skip
          return;
        }

        await this.repository.createRecommendation({
          patientUserId,
          doctorId,
          doctorName,
          organizationId,
          deviceId: device.deviceId,
          category: device.category,
          name: device.name,
        });

        // Publish event
        await publishEvent(
          {
            eventType: 'Device.Recommended',
            patientUserId,
            doctorId,
            organizationId,
            deviceId: device.deviceId,
            timestamp: Date.now(),
          },
          correlationId,
        );
      }),
    );

    await publishRecommendationNotification({
      userId: patientUserId,
      organizationId,
      doctorName,
      devices,
      correlationId,
    });
    logger.info({ event: 'devices_recommended', count: devices.length });
  }

  /**
   * Remove a device recommendation
   */
  async removeRecommendation(patientUserId: string, deviceId: string, correlationId?: string): Promise<void> {
    const logger = createChildLogger(baseLogger, { correlationId, patientUserId, deviceId });
    logger.info({ event: 'service_removeRecommendation_start' });

    const recommendation = await this.repository.getRecommendation(patientUserId, deviceId);
    if (!recommendation) {
      throw new RecommendationNotFoundError(patientUserId, deviceId);
    }

    // Cannot remove already paired devices
    if (recommendation.status === 'PAIRED') {
      throw new RecommendationCannotRemovePairedError(deviceId);
    }

    await this.repository.deleteRecommendation(patientUserId, deviceId);
    logger.info({ event: 'recommendation_removed', deviceId });
  }

  /**
   * Get user recommendations
   */
  async getUserRecommendations(userId: string): Promise<DeviceRecommendation[]> {
    const logger = createChildLogger(baseLogger, { userId });
    logger.info({ event: 'service_getUserRecommendations_start' });

    const recommendations = await this.repository.getUserRecommendations(userId);
    logger.info({ event: 'service_getUserRecommendations_success', count: recommendations.length });
    return recommendations;
  }

  /**
   * Get patient recommendations (for doctor viewing patient)
   */
  async getPatientRecommendations(patientUserId: string): Promise<DeviceRecommendation[]> {
    return this.getUserRecommendations(patientUserId);
  }

  /**
   * Mark recommendation as paired (when device is registered)
   */
  async markRecommendationAsPaired(patientUserId: string, deviceId: string): Promise<void> {
    const logger = createChildLogger(baseLogger, { patientUserId, deviceId });
    logger.info({ event: 'service_markRecommendationAsPaired_start' });

    await this.repository.updateRecommendationStatus(patientUserId, deviceId, 'PAIRED');
    logger.info({ event: 'recommendation_marked_paired', deviceId });
  }
}
