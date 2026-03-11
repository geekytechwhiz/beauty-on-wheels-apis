import { createChildLogger, createLogger } from '@api-hub/logger';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

/**
 * Provides the list of HMS (TruTech) doctor IDs that should be included in
 * background synchronization.
 *
 * NOTE:
 * - For now this implementation relies on a configuration-driven list
 *   via the REGISTERED_HMS_DOCTOR_IDS environment variable, formatted as
 *   a comma-separated list of numeric doctor IDs.
 * - This keeps the scheduler logic decoupled from persistence details and
 *   can be replaced later with a DB-backed implementation without changing
 *   the callers.
 */
export class RegisteredDoctorService {
  private readonly logger = createChildLogger(baseLogger, {
    component: 'RegisteredDoctorService',
  });

  async getRegisteredDoctorIds(correlationId: string): Promise<number[]> {
    const logger = createChildLogger(this.logger, { correlationId });

    let raw: string | string[] = process.env.REGISTERED_HMS_DOCTOR_IDS || '';

    if (!raw.trim()) {
      logger.info({
        event: 'registered_doctors_config_missing',
        message:
          'No REGISTERED_HMS_DOCTOR_IDS configured; background sync will be a no-op',
      });
      raw = [];
    }

    const ids = Array.isArray(raw) ? raw : raw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);

    
    logger.info({
      event: 'registered_doctors_resolved',
      count: ids.length,
    });

    return ids as number[];
  }
}

let registeredDoctorServiceInstance: RegisteredDoctorService | null = null;

export function getRegisteredDoctorService(): RegisteredDoctorService {
  if (!registeredDoctorServiceInstance) {
    registeredDoctorServiceInstance = new RegisteredDoctorService();
  }
  return registeredDoctorServiceInstance;
}

