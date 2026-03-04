import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import { getTruTechAdapter } from '../adapters/TruTech.adapter';
import { Appointment, PatientEMRSummary, SSOError } from '../types';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

/**
 * InternalServiceClient
 *
 * Thin wrapper around downstream teleconsultation-related APIs.
 * This client is intentionally minimal and delegates HTTP concerns
 * to the TruTech adapter while providing a stable internal boundary.
 */
export class InternalServiceClient {
  private readonly logger = createChildLogger(baseLogger, { component: 'InternalServiceClient' });
  private readonly truTechAdapter = getTruTechAdapter();
  async getTodaysAppointments(
    doctorId: number,
    correlationId: string
  ): Promise<Appointment[]> {
    const logger = createChildLogger(this.logger, { correlationId, doctorId });

    logger.info({
      event: 'internal_get_todays_appointments_start',
      doctorId,
    });

    try {
      const appointments = await this.truTechAdapter.getTodaysAppointments(doctorId, correlationId);

      logger.info({
        event: 'internal_get_todays_appointments_success',
        doctorId,
        appointmentCount: appointments.length,
      });

      return appointments;
    } catch (error) {
      if (error instanceof SSOError) {
        throw error;
      }

      logger.error({
        event: 'internal_get_todays_appointments_error',
        doctorId,
        err: serializeError(error as Error),
      });

      throw SSOError.downstreamError(
        'Failed to fetch today\'s appointments',
        error as Error
      );
    }
  }

  async getPatientEMRSummary(
    patientId: number,
    correlationId: string
  ): Promise<PatientEMRSummary> {
    const logger = createChildLogger(this.logger, { correlationId, patientId });

    logger.info({
      event: 'internal_get_patient_emr_start',
      patientId,
    });

    try {
      const summary = await this.truTechAdapter.getPatientEMRSummary(patientId, correlationId);

      logger.info({
        event: 'internal_get_patient_emr_success',
        patientId,
        visitCount: summary.visits.length,
      });

      return summary;
    } catch (error) {
      if (error instanceof SSOError) {
        throw error;
      }

      logger.error({
        event: 'internal_get_patient_emr_error',
        patientId,
        err: serializeError(error as Error),
      });

      throw SSOError.downstreamError(
        'Failed to fetch patient EMR summary',
        error as Error
      );
    }
  }
}

let internalServiceClientInstance: InternalServiceClient | null = null;

export function getInternalServiceClient(): InternalServiceClient {
  if (!internalServiceClientInstance) {
    internalServiceClientInstance = new InternalServiceClient();
  }
  return internalServiceClientInstance;
}

