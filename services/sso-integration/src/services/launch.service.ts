import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import { getTruTechAdapter } from '../adapters/TruTech.adapter';
import { SSOError, TruTechVerifiedPayload } from '../types';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

export class LaunchService {
  private readonly logger = createChildLogger(baseLogger, { component: 'LaunchService' });
  private readonly truTechAdapter = getTruTechAdapter();

  async verifyLaunchToken(
    launchToken: string,
    correlationId: string,
  ): Promise<TruTechVerifiedPayload> {
    const logger = createChildLogger(this.logger, { correlationId });

    logger.info({
      event: 'launch_verify_start',
    });

    try {
      const payload = await this.truTechAdapter.verifyLaunchToken(launchToken, correlationId);

      logger.info({
        event: 'launch_verify_success',
        doctorId: payload.doctorId,
        tenantId: payload.tenantId,
      });

      return payload;
    } catch (error) {
      if (error instanceof SSOError) {
        logger.warn({
          event: 'launch_verify_error',
          code: error.code,
          statusCode: error.statusCode,
          message: error.message,
        });
        throw error;
      }

      logger.error({
        event: 'launch_verify_unexpected_error',
        err: serializeError(error as Error),
      });

      throw SSOError.internalError('Failed to verify launch token', error as Error);
    }
  }
}

let launchServiceInstance: LaunchService | null = null;

export function getLaunchService(): LaunchService {
  if (!launchServiceInstance) {
    launchServiceInstance = new LaunchService();
  }
  return launchServiceInstance;
}

