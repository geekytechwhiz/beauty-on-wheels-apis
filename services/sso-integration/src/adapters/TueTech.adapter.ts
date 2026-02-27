import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import { HMSVerifiedPayload, SSOError, TeleconsultationDetails } from '../types';
import { TeleconsultationClaim } from '../claims/teleconsultation.claim';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

export class ProjectXAdapter {
  private readonly logger = createChildLogger(baseLogger, { component: 'ProjectXAdapter' });
  private readonly teleconsultationClaim = new TeleconsultationClaim();

  async getTeleconsultationDetails(
    payload: HMSVerifiedPayload,
    correlationId: string
  ): Promise<TeleconsultationDetails> {
    const logger = createChildLogger(this.logger, { correlationId });

    logger.info({
      event: 'projectx_teleconsultation_start',
      doctorId: payload.doctorId,
      tenantId: payload.tenantId,
    });

    if (!payload.doctorId || payload.doctorId <= 0) {
      logger.warn({
        event: 'projectx_invalid_doctor_id',
        doctorId: payload.doctorId,
      });
      throw SSOError.invalidRequest('Doctor ID is required for teleconsultation');
    }

    if (!payload.tenantId) {
      logger.warn({
        event: 'projectx_invalid_tenant_id',
      });
      throw SSOError.invalidRequest('Tenant ID is required for teleconsultation');
    }

    try {
      const details = await this.teleconsultationClaim.getTeleconsultationDetails(
        payload.doctorId,
        payload.tenantId,
        correlationId
      );

      logger.info({
        event: 'projectx_teleconsultation_success',
        doctorId: details.doctorId,
        tenantId: details.tenantId,
        appointmentCount: details.appointments.length,
        emrSummaryCount: details.emrSummaries.length,
      });

      return details;
    } catch (error) {
      if (error instanceof SSOError) {
        throw error;
      }

      logger.error({
        event: 'projectx_teleconsultation_error',
        err: serializeError(error as Error),
      });

      throw SSOError.internalError(
        'Failed to fetch teleconsultation details',
        error as Error
      );
    }
  }
}

