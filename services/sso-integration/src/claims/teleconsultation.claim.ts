import { createLogger, createChildLogger, createPerformanceTimer, serializeError } from '@api-hub/logger';
import { getAppointmentsService } from '../services/appointments.service';
import { Appointment, PatientEMRSummary, TeleconsultationDetails, SSOError } from '../types';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

export class TeleconsultationClaim {
  private readonly logger = createChildLogger(baseLogger, { component: 'TeleconsultationClaim' });
  private readonly appointmentsService = getAppointmentsService();

  async getTeleconsultationDetails(
    doctorId: number,
    tenantId: string,
    correlationId: string
  ): Promise<TeleconsultationDetails> {
    const logger = createChildLogger(this.logger, { correlationId, doctorId, tenantId });
    const timer = createPerformanceTimer(logger, 'teleconsultation_claim');

    logger.info({
      event: 'teleconsultation_claim_start',
      doctorId,
      tenantId,
    });

    try {
      if (!doctorId || doctorId <= 0) {
        throw SSOError.invalidRequest('Invalid doctor ID');
      }

      if (!tenantId) {
        throw SSOError.invalidRequest('Invalid tenant ID');
      }

      const appointments = await this.internalClient.getTodaysAppointments(
        doctorId,
        correlationId
      );

      const emrSummaries = await this.fetchEmrSummariesForAppointments(
        appointments,
        correlationId,
        logger
      );

      const details: TeleconsultationDetails = {
        doctorId,
        tenantId,
        appointments,
        emrSummaries,
      };

      timer.end();

      logger.info({
        event: 'teleconsultation_claim_success',
        doctorId,
        tenantId,
        appointmentCount: appointments.length,
        emrSummaryCount: emrSummaries.length,
      });

      return details;
    } catch (error) {
      timer.end();

      if (error instanceof SSOError) {
        throw error;
      }

      logger.error({
        event: 'teleconsultation_claim_error',
        err: serializeError(error as Error),
      });

      throw SSOError.internalError(
        'Failed to build teleconsultation details',
        error as Error
      );
    }
  }

  private async fetchEmrSummariesForAppointments(
    appointments: Appointment[],
    correlationId: string,
    logger: ReturnType<typeof createChildLogger>
  ): Promise<PatientEMRSummary[]> {
    const uniquePatientIds = Array.from(
      new Set(
        appointments
          .map((appt) => appt.patient?.id)
          .filter((id): id is number => typeof id === 'number' && id > 0)
      )
    );

    logger.info({
      event: 'teleconsultation_fetch_emr_start',
      patientCount: uniquePatientIds.length,
    });

    const summaries: PatientEMRSummary[] = [];

    for (const patientId of uniquePatientIds) {
      try {
        const summary = await this.internalClient.getPatientEMRSummary(
          patientId,
          correlationId
        );
        summaries.push(summary);
      } catch (error) {
        if (error instanceof SSOError && error.code === 'NOT_FOUND') {
          logger.warn({
            event: 'teleconsultation_emr_not_found',
            patientId,
          });
          continue;
        }

        logger.warn({
          event: 'teleconsultation_emr_error_non_fatal',
          patientId,
          err: serializeError(error as Error),
        });
      }
    }

    logger.info({
      event: 'teleconsultation_fetch_emr_complete',
      fetchedSummaries: summaries.length,
    });

    return summaries;
  }
}

