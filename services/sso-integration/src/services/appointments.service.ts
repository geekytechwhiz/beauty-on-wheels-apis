import { createLogger, createChildLogger, serializeError, createPerformanceTimer } from '@api-hub/logger';
import { getTruTechAdapter } from '../adapters/TruTech.adapter';
import {
  Appointment,
  PatientEMRSummary,
  AppointmentsResponse,
  PatientEMRResponse,
  SSOError,
} from '../types';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

export class AppointmentsService {
  private readonly logger = createChildLogger(baseLogger, { component: 'AppointmentsService' });
  private readonly truTechAdapter = getTruTechAdapter();

  // ---------------------------------------------------------------------------
  // Get Today's Appointments for a Doctor
  // ---------------------------------------------------------------------------

  async getTodaysAppointments(
    doctorId: number,
    correlationId: string
  ): Promise<Appointment[]> {
    const logger = createChildLogger(this.logger, { correlationId, doctorId });
    const timer = createPerformanceTimer(logger, 'get_todays_appointments');

    logger.info({
      event: 'get_appointments_start',
      doctorId,
    });

    try {
      if (!doctorId || doctorId <= 0) {
        throw SSOError.invalidRequest('Invalid doctor ID');
      }

      const appointments = await this.truTechAdapter.getTodaysAppointments(
        doctorId,
        correlationId
      );

      timer.end();

      logger.info({
        event: 'get_appointments_success',
        doctorId,
        appointmentCount: appointments.length,
      });

      return appointments;
    } catch (error) {
      timer.end();

      if (error instanceof SSOError) {
        logger.warn({
          event: 'get_appointments_error',
          doctorId,
          errorCode: error.code,
          message: error.message,
        });
        throw error;
      }

      logger.error({
        event: 'get_appointments_unexpected_error',
        doctorId,
        err: serializeError(error as Error),
      });

      throw SSOError.internalError(
        'Failed to fetch appointments',
        error as Error
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Get Patient EMR Summary
  // ---------------------------------------------------------------------------

  async getPatientEMRSummary(
    patientId: number,
    doctorId: number,
    correlationId: string
  ): Promise<PatientEMRSummary> {
    const logger = createChildLogger(this.logger, { correlationId, patientId, doctorId });
    const timer = createPerformanceTimer(logger, 'get_patient_emr');

    logger.info({
      event: 'get_emr_start',
      patientId,
      doctorId,
    });

    try {
      if (!patientId || patientId <= 0) {
        throw SSOError.invalidRequest('Invalid patient ID');
      }

      const emrSummary = await this.truTechAdapter.getPatientEMRSummary(
        patientId,
        correlationId
      );

      timer.end();

      logger.info({
        event: 'get_emr_success',
        patientId,
        visitCount: emrSummary.visits.length,
      });

      return emrSummary;
    } catch (error) {
      timer.end();

      if (error instanceof SSOError) {
        logger.warn({
          event: 'get_emr_error',
          patientId,
          errorCode: error.code,
          message: error.message,
        });
        throw error;
      }

      logger.error({
        event: 'get_emr_unexpected_error',
        patientId,
        err: serializeError(error as Error),
      });

      throw SSOError.internalError(
        'Failed to fetch patient EMR',
        error as Error
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Format Response Helpers
  // ---------------------------------------------------------------------------

  formatAppointmentsResponse(appointments: Appointment[]): AppointmentsResponse {
    return {
      success: true,
      data: {
        appointments,
        count: appointments.length,
        date: new Date().toISOString().split('T')[0],
      },
    };
  }

  formatEMRResponse(emrSummary: PatientEMRSummary): PatientEMRResponse {
    return {
      success: true,
      data: emrSummary,
    };
  }
}

let appointmentsServiceInstance: AppointmentsService | null = null;

export function getAppointmentsService(): AppointmentsService {
  if (!appointmentsServiceInstance) {
    appointmentsServiceInstance = new AppointmentsService();
  }
  return appointmentsServiceInstance;
}
