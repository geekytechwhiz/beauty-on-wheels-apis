import {
  createChildLogger,
  createPerformanceTimer,
  serializeError,
} from '@api-hub/logger';
import { Appointment, PatientEMRSummary } from '../../types';
import { SSOError } from '../../types/errors/sso-error';

type TruTechClient = {
  getAppointmentsForDoctorsInRange: (
    startDate: string,
    endDate: string,
    correlationId: string,
  ) => Promise<{
    status: string;
    appointments?: unknown[];
    message?: string;
  }>;
  getTodaysAppointments: (
    doctorId: number,
    correlationId: string,
  ) => Promise<{ appointments?: unknown[] }>;
  getPatientEMRSummary: (
    patientId: number,
    correlationId: string,
  ) => Promise<{ emr?: unknown[] }>;
};

type TruTechAdapter = {
  mapAppointments: (appointments: unknown[]) => Appointment[];
  mapPatientEMRSummary: (
    response: unknown,
    patientId: number,
  ) => PatientEMRSummary;
};

export class HmsAppointmentService {
  constructor(
    private readonly truTechClient: TruTechClient,
    private readonly truTechAdapter: TruTechAdapter,
    private readonly logger: any,
  ) {}

  async getAppointmentsForDoctorsInRange(
    startDate: string,
    endDate: string,
    correlationId: string,
  ): Promise<Appointment[]> {
    const logger = createChildLogger(this.logger, {
      correlationId,
      startDate,
      endDate,
    });

    const timer = createPerformanceTimer(
      logger,
      'hms_get_appointments_for_doctors_in_range',
    );

    logger.info({
      event: 'hms_get_appointments_for_doctors_in_range_start',
      startDate,
      endDate,
    });

    try {
      const response = await this.truTechClient.getAppointmentsForDoctorsInRange(
        startDate,
        endDate,
        correlationId,
      );

      logger.debug({
        event: 'hms_trutech_range_response',
        status: response.status,
        hasAppointmentsArray: !!response.appointments,
        appointmentCount: response.appointments?.length ?? 0,
        hasMessage: !!response.message,
      });

      timer.end();

      if (!response.appointments?.length) {
        logger.info({
          event: 'hms_get_appointments_for_doctors_in_range_no_appointments',
          appointments: response.appointments?.length,
          startDate,
          endDate,
        });
        return [];
      }

      const mapped = this.truTechAdapter.mapAppointments(
        response.appointments || [],
      );

      logger.info({
        event: 'hms_get_appointments_for_doctors_in_range_success',
        appointmentCount: mapped.length,
        startDate,
        endDate,
      });

      return mapped;
    } catch (error) {
      timer.end();

      if (error instanceof SSOError) {
        logger.warn({
          event: 'hms_get_appointments_for_doctors_in_range_error',
          startDate,
          endDate,
          errorCode: error.code,
          message: error.message,
        });
        throw error;
      }

      logger.error({
        event: 'hms_get_appointments_for_doctors_in_range_unexpected_error',
        startDate,
        endDate,
        err: serializeError(error as Error),
      });

      throw SSOError.internalError(
        'Failed to fetch appointments from HMS for doctors',
        error as Error,
      );
    }
  }

  async getTodaysAppointments(
    doctorId: number,
    correlationId: string,
  ): Promise<Appointment[]> {
    const response = await this.truTechClient.getTodaysAppointments(
      doctorId,
      correlationId,
    );
    return this.truTechAdapter.mapAppointments(response.appointments || []);
  }

  async getPatientEMRSummary(
    patientId: number,
    doctorId: number,
    correlationId: string,
  ): Promise<PatientEMRSummary> {
    const logger = createChildLogger(this.logger, {
      correlationId,
      patientId,
      doctorId,
    });
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

      const truTechPatientEMRResponse =
        await this.truTechClient.getPatientEMRSummary(
          patientId,
          correlationId,
        );

      timer.end();

      logger.info({
        event: 'get_emr_success',
        patientId,
        visitCount: truTechPatientEMRResponse.emr?.length || 0,
      });

      return this.truTechAdapter.mapPatientEMRSummary(
        truTechPatientEMRResponse,
        patientId,
      );
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
        error as Error,
      );
    }
  }
}

