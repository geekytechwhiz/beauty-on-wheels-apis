import {
  createChildLogger,
  createPerformanceTimer,
  serializeError,
} from '@api-hub/logger';
import { Appointment, AppointmentStatus, PatientEMRSummary } from '../../types';
import { SSOError } from '../../types/errors/sso-error';
import { appendSuffixToContacts } from '../../utils/helper';
import { getTruTechClientForTenant } from '../../clients/tru-tech.clients';
import { TruTechAdapter } from '../../adapters/trutech.adapter.ts';
import { TruTechPatientEMRResponse } from '../../types/external/trutech.types';
import { VisitStatus, VisitType } from '../../types/enums';

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

export class HmsAppointmentService {
  constructor(
    private readonly truTechClient: TruTechClient,
    private readonly truTechAdapter: TruTechAdapter,
    private readonly logger: any,
  ) {
    this.truTechAdapter = new TruTechAdapter();
  }

  /**
   * @param tenantId Optional. When provided, uses per-tenant HMS config (getTruTechClientForTenant).
   */
  async getAppointmentsForDoctorsInRange(
    startDate: string,
    endDate: string,
    correlationId: string,
    tenantId?: string,
  ): Promise<Appointment[]> {
    const logger = createChildLogger(this.logger, {
      correlationId,
      startDate,
      endDate,
      tenantId,
    });

    const timer = createPerformanceTimer(
      logger,
      'hms_get_appointments_for_doctors_in_range',
    );

    const client = tenantId
      ? getTruTechClientForTenant(tenantId)
      : this.truTechClient;

    logger.info({
      event: 'hms_get_appointments_for_doctors_in_range_start',
      startDate,
      endDate,
      tenantId,
    });

    try {
      const response = await client.getAppointmentsForDoctorsInRange(
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
      //   const mappedAppointments: Appointment[] =  [
      //     {
      //         "appointmentId": 80,
      //         "startTime": "2026-03-14T17:00:00.000000Z",
      //         "endTime": "2026-03-14T17:15:00.000000Z",
      //         "status": AppointmentStatus.SCHEDULED,
      //         "notes": null,
      //         "patient": {
      //             "id": 1234,
      //             "mrn": "MR0002195",
      //             "name": "Suhas M",
      //             "gender": "Male",
      //             "age": "26 years",
      //             "dob": null,
      //             "phone": "9073421399",
      //             "email": null
      //         },
      //         "doctor": {
      //             "id": 987,
      //             "name": "ABDUL RASHID AHMED",
      //             "department": "GENERAL DOCTORS",
      //             "phone": "123456789",
      //             "email": "doc.trutech@yopmail.com"
      //         },
      //         "consultationType": {
      //             "id": 208,
      //             "name": "Test Consultation"
      //         },
      //         "visit": {
      //             "id": 1091,
      //             "visitType": VisitType.TELECONSULTATION,
      //             "createdAt": "2026-03-14T08:57:01.000000Z",
      //             "status": VisitStatus.ACTIVE
      //         }
      //     }
      // ]
      let mappedAppointments = this.truTechAdapter.mapAppointments(
        response.appointments as any[],
      );
      const isPendingAppointmentBypassEnabled = (): boolean =>
        process.env.BYPASS_SUFFIX_APPOINTMENTS === 'true';
      if (isPendingAppointmentBypassEnabled()) {
        mappedAppointments = this.truTechAdapter.mapAppointments(
          response.appointments as any[],
        );
      } else {
        const appointmentsWithSuffix = appendSuffixToContacts(
          response.appointments,
          'c',
        );
        mappedAppointments = this.truTechAdapter.mapAppointments(
          appointmentsWithSuffix as any[],
        );
      }

      logger.info({
        event: 'hms_get_appointments_for_doctors_in_range_success',
        appointmentCount: mappedAppointments.length,
        startDate,
        endDate,
      });

      return mappedAppointments;
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
    return this.truTechAdapter.mapAppointments(response.appointments as any[]);
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
        await this.truTechClient.getPatientEMRSummary(patientId, correlationId);

      timer.end();

      logger.info({
        event: 'get_emr_success',
        patientId,
        visitCount: truTechPatientEMRResponse.emr?.length || 0,
      });

      return this.truTechAdapter.mapPatientEMRSummary(
        truTechPatientEMRResponse as TruTechPatientEMRResponse,
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
