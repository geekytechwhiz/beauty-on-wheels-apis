import axios, { AxiosError, AxiosInstance } from 'axios';
import {
  createLogger,
  createChildLogger,
  serializeError,
} from '@api-hub/logger';
import { getEnvConfig } from '../config/env';
import {
  TruTechVerifyResponse, 
  TruTechAppointmentsResponse,
  TruTechAppointment,
  Appointment,
  Patient,
  Doctor,
  ConsultationType,
  Visit,
  AppointmentStatus,
  VisitType,
  VisitStatus,
  TruTechPatientEMRResponse,
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
    const config = getEnvConfig();

    this.client = axios.create({
      baseURL: config.TRU_TECH_BASE_URL,
      timeout: config.TRU_TECH_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${config.TRU_TECH_API_KEY}`,
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
  // POST /api/teleconsultation/verify
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
      const response = await this.client.post<TruTechVerifyResponse>(
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
          response.data.message ||
            'TruTech teleconsultation token verification failed',
        );
      }

      const { doctor_uid, context } = response.data;

      logger.info({
        event: 'tru_tech_verify_success',
        durationMs: duration,
        tenantId: context?.tenant_id,
        doctorId: context?.drid,
        hasSessionId: !!context?.session_id,
      });

      return {
        doctorUid: doctor_uid,
        doctorId: context?.drid || 0,
        doctorName: context?.name,
        doctorEmail: context?.email || '',
        doctorPhone: context?.doctor_phone,
        specialization: context?.specialization,
        department: context?.department,
        tenantId: context?.tenant_id || '',
        clinicId: context?.clinic_id,
        sessionId: context?.session_id,
        expiresAt: context?.expires_at,
      };
    } catch (error) {
      return this.handleAxiosError(
        error,
        'tru_tech_verify',
        startTime,
        logger,
      );
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
      event: 'tru_tech_appointments_start',
      doctorId,
    });

    try {
      const response = await this.client.post<TruTechAppointmentsResponse>(
        '/api/teleconsultation/todays-appointments',
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
          event: 'tru_tech_appointments_failed',
          durationMs: duration,
          errorMessage: response.data.message,
        });
        throw SSOError.truTechServiceError(
          response.data.message || 'Failed to fetch appointments',
        );
      }

      const appointments = (response.data.appointments || []).map(
        this.normalizeAppointment,
      );

      logger.info({
        event: 'tru_tech_appointments_success',
        durationMs: duration,
        appointmentCount: appointments.length,
      });

      return appointments;
    } catch (error) {
      return this.handleAxiosError(
        error,
        'tru_tech_appointments',
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
      event: 'tru_tech_emr_start',
      patientId,
    });

    try {
      const response = await this.client.post<TruTechPatientEMRResponse>(
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
          event: 'tru_tech_emr_failed',
          durationMs: duration,
          errorMessage: response.data.message,
        });

        if (response.data.message?.toLowerCase().includes('not found')) {
          throw SSOError.notFound('Patient not found');
        }

        throw SSOError.truTechServiceError(
          response.data.message || 'Failed to fetch patient EMR',
        );
      }

      const visits = (response.data.emr || []).map(this.normalizeEMRVisit);

      logger.info({
        event: 'tru_tech_emr_success',
        durationMs: duration,
        visitCount: visits.length,
      });

      return {
        patientId: response.data.patient_id || patientId,
        visits,
      };
    } catch (error) {
      return this.handleAxiosError(
        error,
        'tru_tech_emr',
        startTime,
        logger,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Normalize TruTech Appointment to Internal Format
  // ---------------------------------------------------------------------------

  private normalizeAppointment(truTechAppointment: TruTechAppointment): Appointment {
    return {
      appointmentId: truTechAppointment.appointment_id,
      startTime: truTechAppointment.start_time,
      endTime: truTechAppointment.end_time,
      status: truTechAppointment.status as AppointmentStatus,
      notes: truTechAppointment.notes,
      patient: {
        id: truTechAppointment.patient.id,
        mrn: truTechAppointment.patient.mrn,
        name: truTechAppointment.patient.name,
        gender: truTechAppointment.patient.gender,
        age: truTechAppointment.patient.age,
        dateOfBirth: truTechAppointment.patient.dob,
        phone: truTechAppointment.patient.phone,
        email: truTechAppointment.patient.email,
      } as Patient,
      doctor: {
        id: truTechAppointment.doctor.id,
        name: truTechAppointment.doctor.name,
        department: truTechAppointment.doctor.department,
        phone: truTechAppointment.doctor.phone,
        email: truTechAppointment.doctor.email,
      } as Doctor,
      consultationType: {
        id: truTechAppointment.consultation_type.id,
        name: truTechAppointment.consultation_type.name,
      } as ConsultationType,
      visit: {
        id: truTechAppointment.visit.id,
        visitType: truTechAppointment.visit.visit_type as VisitType,
        createdAt: truTechAppointment.visit.created_at,
        status: truTechAppointment.visit.status as VisitStatus,
      } as Visit,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Normalize TruTech EMR Visit to Internal Format
  // ---------------------------------------------------------------------------

  private normalizeEMRVisit(
    truTechVisit: import('../types').TruTechEMRVisit,
  ): EMRVisit {
    return {
      visitId: truTechVisit.visit_id,
      visitType: truTechVisit.visit_type,
      date: truTechVisit.date,
      diagnosis: (truTechVisit.diagnosis || []).map((d) => ({
        code: d.code,
        name: d.name,
        type: d.type,
      })),
      vitals: (truTechVisit.vitals || []).map((v) => ({
        name: v.name,
        value: v.value,
        unit: v.unit,
        recordedAt: v.recorded_at,
      })),
      medicines: (truTechVisit.medicines || []).map((m) => ({
        name: m.name,
        dosage: m.dosage,
        frequency: m.frequency,
        duration: m.duration,
        instructions: m.instructions,
      })),
      investigations: (truTechVisit.investigations || []).map((i) => ({
        name: i.name,
        result: i.result,
        status: i.status,
        date: i.date,
      })),
      services: (truTechVisit.services || []).map((s) => ({
        name: s.name,
        status: s.status,
        date: s.date,
      })),
      allergies: (truTechVisit.allergies || []).map((a) => ({
        allergen: a.allergen,
        reaction: a.reaction,
        severity: a.severity,
      })),
      followups: (truTechVisit.followups || []).map((f) => ({
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
        throw SSOError.downstreamError('TruTech request timed out', axiosError);
      }

      if (axiosError.response?.status === 401) {
        throw SSOError.unauthorized('TruTech API key invalid or missing');
      }

      if (axiosError.response?.status === 404) {
        throw SSOError.notFound('Resource not found in TruTech');
      }

      if (axiosError.response?.status && axiosError.response.status >= 500) {
        throw SSOError.truTechServiceError('TruTech service unavailable', axiosError);
      }

      throw SSOError.truTechServiceError(
        `TruTech request failed: ${axiosError.message}`,
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
