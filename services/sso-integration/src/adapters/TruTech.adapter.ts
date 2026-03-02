import axios, { AxiosError, AxiosInstance } from 'axios';
import {
  createLogger,
  createChildLogger,
  serializeError,
} from '@api-hub/logger';
import { getEnvConfig } from '../config/env';
import {
  HMSVerifyResponse, 
  HMSAppointmentsResponse,
  HMSAppointment,
  Appointment,
  Patient,
  Doctor,
  ConsultationType,
  Visit,
  AppointmentStatus,
  VisitType,
  VisitStatus,
  HMSPatientEMRResponse,
  PatientEMRSummary,
  EMRVisit,
  SSOError,
  TruTechVerifiedPayload,
} from '../types';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

export class TruTechAdapter {
  private readonly client: AxiosInstance;
  private readonly logger = createChildLogger(baseLogger, {
    component: 'TruTechAdapter',
  });

  constructor() {
    const config:any = getEnvConfig();

    this.client = axios.create({
      baseURL: config.TRU_TECH_BASE_URL,
      timeout: config.TRU_TECH_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.TRU_TECH_API_KEY,
      },
    });

    this.client.interceptors.request.use((request) => {
      this.logger.debug({
        event: 'tru_tech_request_start',
        method: request.method?.toUpperCase(),
        url: request.url,
      });
      return request;
    });

    this.client.interceptors.response.use(
      (response) => {
        this.logger.debug({
          event: 'tru_tech_request_complete',
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      (error: AxiosError) => {
        this.logger.error({
          event: 'tru_tech_request_error',
          status: error.response?.status,
          url: error.config?.url,
          message: error.message,
        });
        return Promise.reject(error);
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Verify Launch Token
  // POST /api/tru-tech/verify
  // ---------------------------------------------------------------------------

  async verifyLaunchToken(
    launchToken: string,
    correlationId: string,
  ): Promise<TruTechVerifiedPayload> {
    const logger = createChildLogger(this.logger, { correlationId });
    const startTime = Date.now();

    logger.info({
      event: 'tru_tech_verify_start',
      tokenLength: launchToken.length,
    });

    try {
      const response = await this.client.post<HMSVerifyResponse>(
        '/api/teleconsultation/verify',
        { launch_token: launchToken },
        {
          headers: {
            'X-Correlation-Id': correlationId,
          },
        },
      );

      const duration = Date.now() - startTime;

      if (response.data.status !== 'success' || !response.data.doctor_uid) {
        logger.warn({
          event: 'tru_tech_verify_failed',
          durationMs: duration,
          errorMessage: response.data.message,
        });
        throw SSOError.verificationFailed(
          response.data.message || 'HMS token verification failed',
        );
      }

      const { doctor_uid, context } = response.data;

      logger.info({
        event: 'hms_verify_success',
        durationMs: duration,
        tenantId: context?.tenant_id,
        doctorId: context?.doctor_id,
        hasSessionId: !!context?.session_id,
      });

      return {
        doctorUid: doctor_uid,
        doctorId: context?.doctor_id || 0,
        doctorName: context?.doctor_name,
        doctorEmail: context?.doctor_email,
        doctorPhone: context?.doctor_phone,
        specialization: context?.specialization,
        department: context?.department,
        tenantId: context?.tenant_id || '',
        clinicId: context?.clinic_id,
        sessionId: context?.session_id,
        expiresAt: context?.expires_at,
      };
    } catch (error) {
      return this.handleAxiosError(error, 'hms_verify', startTime, logger);
    }
  }

  // ---------------------------------------------------------------------------
  // Get Today's Appointments
  // POST /api/teleconsultation/todays-appointments
  // ---------------------------------------------------------------------------

  async getTodaysAppointments(
    doctorId: number,
    correlationId: string,
  ): Promise<Appointment[]> {
    const logger = createChildLogger(this.logger, { correlationId, doctorId });
    const startTime = Date.now();

    logger.info({
      event: 'hms_appointments_start',
      doctorId,
    });

    try {
      const response = await this.client.post<HMSAppointmentsResponse>(
        '/api/teleconsultation/todays-appointments', // TODO: change to /api/teleconsultation/appointments/today
        { doctor_id: doctorId },
        {
          headers: {
            'X-Correlation-Id': correlationId,
          },
        },
      );

      const duration = Date.now() - startTime;

      if (response.data.status !== 'success') {
        logger.warn({
          event: 'hms_appointments_failed',
          durationMs: duration,
          errorMessage: response.data.message,
        });
        throw SSOError.hmsServiceError(
          response.data.message || 'Failed to fetch appointments',
        );
      }

      const appointments = (response.data.appointments || []).map(
        this.normalizeAppointment,
      );

      logger.info({
        event: 'hms_appointments_success',
        durationMs: duration,
        appointmentCount: appointments.length,
      });

      return appointments;
    } catch (error) {
      return this.handleAxiosError(
        error,
        'hms_appointments',
        startTime,
        logger,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Get Patient EMR Summary
  // POST /api/teleconsultation/patient-emr-summary
  // ---------------------------------------------------------------------------

  async getPatientEMRSummary(
    patientId: number,
    correlationId: string,
  ): Promise<PatientEMRSummary> {
    const logger = createChildLogger(this.logger, { correlationId, patientId });
    const startTime = Date.now();

    logger.info({
      event: 'hms_emr_start',
      patientId,
    });

    try {
      const response = await this.client.post<HMSPatientEMRResponse>(
        '/api/teleconsultation/patient-emr-summary',
        { patient_id: patientId },
        {
          headers: {
            'X-Correlation-Id': correlationId,
          },
        },
      );

      const duration = Date.now() - startTime;

      if (response.data.status !== 'success') {
        logger.warn({
          event: 'hms_emr_failed',
          durationMs: duration,
          errorMessage: response.data.message,
        });

        if (response.data.message?.toLowerCase().includes('not found')) {
          throw SSOError.notFound('Patient not found');
        }

        throw SSOError.hmsServiceError(
          response.data.message || 'Failed to fetch patient EMR',
        );
      }

      const visits = (response.data.emr || []).map(this.normalizeEMRVisit);

      logger.info({
        event: 'hms_emr_success',
        durationMs: duration,
        visitCount: visits.length,
      });

      return {
        patientId: response.data.patient_id || patientId,
        visits,
      };
    } catch (error) {
      return this.handleAxiosError(error, 'hms_emr', startTime, logger);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Normalize HMS Appointment to Internal Format
  // ---------------------------------------------------------------------------

  private normalizeAppointment(hmsAppointment: HMSAppointment): Appointment {
    return {
      appointmentId: hmsAppointment.appointment_id,
      startTime: hmsAppointment.start_time,
      endTime: hmsAppointment.end_time,
      status: hmsAppointment.status as AppointmentStatus,
      notes: hmsAppointment.notes,
      patient: {
        id: hmsAppointment.patient.id,
        mrn: hmsAppointment.patient.mrn,
        name: hmsAppointment.patient.name,
        gender: hmsAppointment.patient.gender,
        age: hmsAppointment.patient.age,
        dateOfBirth: hmsAppointment.patient.dob,
        phone: hmsAppointment.patient.phone,
        email: hmsAppointment.patient.email,
      } as Patient,
      doctor: {
        id: hmsAppointment.doctor.id,
        name: hmsAppointment.doctor.name,
        department: hmsAppointment.doctor.department,
        phone: hmsAppointment.doctor.phone,
        email: hmsAppointment.doctor.email,
      } as Doctor,
      consultationType: {
        id: hmsAppointment.consultation_type.id,
        name: hmsAppointment.consultation_type.name,
      } as ConsultationType,
      visit: {
        id: hmsAppointment.visit.id,
        visitType: hmsAppointment.visit.visit_type as VisitType,
        createdAt: hmsAppointment.visit.created_at,
        status: hmsAppointment.visit.status as VisitStatus,
      } as Visit,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Normalize HMS EMR Visit to Internal Format
  // ---------------------------------------------------------------------------

  private normalizeEMRVisit(
    hmsVisit: import('../types').HMSEMRVisit,
  ): EMRVisit {
    return {
      visitId: hmsVisit.visit_id,
      visitType: hmsVisit.visit_type,
      date: hmsVisit.date,
      diagnosis: (hmsVisit.diagnosis || []).map((d) => ({
        code: d.code,
        name: d.name,
        type: d.type,
      })),
      vitals: (hmsVisit.vitals || []).map((v) => ({
        name: v.name,
        value: v.value,
        unit: v.unit,
        recordedAt: v.recorded_at,
      })),
      medicines: (hmsVisit.medicines || []).map((m) => ({
        name: m.name,
        dosage: m.dosage,
        frequency: m.frequency,
        duration: m.duration,
        instructions: m.instructions,
      })),
      investigations: (hmsVisit.investigations || []).map((i) => ({
        name: i.name,
        result: i.result,
        status: i.status,
        date: i.date,
      })),
      services: (hmsVisit.services || []).map((s) => ({
        name: s.name,
        status: s.status,
        date: s.date,
      })),
      allergies: (hmsVisit.allergies || []).map((a) => ({
        allergen: a.allergen,
        reaction: a.reaction,
        severity: a.severity,
      })),
      followups: (hmsVisit.followups || []).map((f) => ({
        date: f.date,
        notes: f.notes,
        doctorId: f.doctor_id,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Handle Axios Errors
  // ---------------------------------------------------------------------------

  private handleAxiosError(
    error: unknown,
    operation: string,
    startTime: number,
    logger: ReturnType<typeof createChildLogger>,
  ): never {
    const duration = Date.now() - startTime;

    if (error instanceof SSOError) {
      throw error;
    }

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      logger.error({
        event: `${operation}_error`,
        durationMs: duration,
        status: axiosError.response?.status,
        code: axiosError.code,
        err: serializeError(axiosError),
      });

      if (
        axiosError.code === 'ECONNABORTED' ||
        axiosError.code === 'ETIMEDOUT'
      ) {
        throw SSOError.downstreamError('HMS request timed out', axiosError);
      }

      if (axiosError.response?.status === 401) {
        throw SSOError.unauthorized('HMS API key invalid or missing');
      }

      if (axiosError.response?.status === 404) {
        throw SSOError.notFound('Resource not found in HMS');
      }

      if (axiosError.response?.status && axiosError.response.status >= 500) {
        throw SSOError.hmsServiceError('HMS service unavailable', axiosError);
      }

      throw SSOError.hmsServiceError(
        `HMS request failed: ${axiosError.message}`,
        axiosError,
      );
    }

    logger.error({
      event: `${operation}_unexpected_error`,
      durationMs: duration,
      err: serializeError(error as Error),
    });

    throw SSOError.internalError(
      `Unexpected error during ${operation}`,
      error as Error,
    );
  }
}

let truTechAdapterInstance: TruTechAdapter | null = null;

export function getTruTechAdapter(): TruTechAdapter {
  if (!truTechAdapterInstance) {
    truTechAdapterInstance = new TruTechAdapter();
  }
  return truTechAdapterInstance;
}
