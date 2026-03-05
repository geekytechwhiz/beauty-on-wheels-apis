import { createLogger, createChildLogger } from '@api-hub/logger';

import {
  TruTechAppointmentsResponse,
  TruTechAppointment,
  Patient,
  Doctor,
  ConsultationType,
  Visit,
  AppointmentStatus,
  EMRVisit,
  PatientEMRSummary, 
  Appointment,
} from '../types';
import { TruTechEMRVisit, TruTechPatientEMRResponse, TruTechVerifyContext, TruTechVerifyResponse, VisitStatus, VisitType } from '../types/appointment.types';
import { SSOError } from '../types/errors/sso-error';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

export class TruTechAdapter {
  private readonly logger = createChildLogger(baseLogger, {
    component: 'TruTechAdapter',
  });

  // ---------------------------------------------------------
  // Verify Launch Response Mapping
  // ---------------------------------------------------------

  mapVerifyResponse(response: TruTechVerifyResponse): TruTechVerifyResponse {
    if (response.status !== 'success' || !response.doctor_uid) {
      throw SSOError.verificationFailed(
        response.message || 'TruTech verification failed',
      );
    }

    const context = response.context;

    return {
      doctor_uid: response.doctor_uid,
      context: {
        ...context,
        tenant_id: context?.tenant_id || '',
        drid: context?.drid || 0,
      } as TruTechVerifyContext,
    };
  }

  // ---------------------------------------------------------
  // Map Appointment List
  // ---------------------------------------------------------

  mapAppointments(response: TruTechAppointmentsResponse): Appointment[] {
    if (response.status !== 'success') {
      throw SSOError.truTechServiceError(
        response.message || 'Failed to fetch appointments',
      );
    }

    return (response.appointments || []).map((appt) =>
      this.normalizeAppointment(appt),
    );
  }

  // ---------------------------------------------------------
  // Map EMR Summary
  // ---------------------------------------------------------

  mapPatientEMRSummary(
    response: TruTechPatientEMRResponse,
    patientId: number,
  ): PatientEMRSummary {
    if (response.status !== 'success') {
      if (response.message?.toLowerCase().includes('not found')) {
        throw SSOError.notFound('Patient not found');
      }

      throw SSOError.truTechServiceError(
        response.message || 'Failed to fetch patient EMR',
      );
    }

    const visits = (response.emr || []).map((visit) =>
      this.normalizeEMRVisit(visit),
    );

    return {
      patientId: response.patient_id || patientId,
      visits,
    };
  }
 

  private normalizeAppointment(appt: TruTechAppointment): Appointment {
    return {
      appointmentId: appt.appointment_id,
      startTime: appt.start_time,
      endTime: appt.end_time,
      status: appt.status as AppointmentStatus,
      notes: appt.notes,

      patient: {
        age: appt.patient.age || null,
        id: appt.patient.id,
        mrn: appt.patient.mrn || '',
        name: appt.patient.name,
        gender: appt.patient.gender,
        dateOfBirth: appt.patient.dob,
        phone: appt.patient.phone,
        email: appt.patient.email,
        dob: appt.patient.dob,
        organizationId: appt.patient.organizationId,
      } as Patient,

      doctor: {
        id: appt.doctor.id,
        name: appt.doctor.name,
        department: appt.doctor.department,
        phone: appt.doctor.phone,
        email: appt.doctor.email,
      } as Doctor,

      consultationType: {
        id: appt.consultation_type.id,
        name: appt.consultation_type.name,
      } as ConsultationType,

      visit: {
        id: appt.visit.id,
        visitType: appt.visit.visit_type as VisitType,
        createdAt: appt.visit.created_at,
        status: appt.visit.status as VisitStatus,
      } as Visit,
    };
  }

  // ---------------------------------------------------------
  // Normalize EMR Visit
  // ---------------------------------------------------------

  private normalizeEMRVisit(visit: TruTechEMRVisit): EMRVisit {
    return {
      visitId: visit.visit_id,
      visitType: visit.visit_type,
      date: visit.date,

      diagnosis: (visit.diagnosis || []).map((d) => ({
        code: d.code,
        name: d.name,
        type: d.type,
      })),

      vitals: (visit.vitals || []).map((v) => ({
        name: v.name,
        value: v.value,
        unit: v.unit,
        recordedAt: v.recorded_at,
      })),

      medicines: (visit.medicines || []).map((m) => ({
        name: m.name,
        dosage: m.dosage,
        frequency: m.frequency,
        duration: m.duration,
        instructions: m.instructions,
      })),

      investigations: (visit.investigations || []).map((i) => ({
        name: i.name,
        result: i.result,
        status: i.status,
        date: i.date,
      })),

      services: (visit.services || []).map((s) => ({
        name: s.name,
        status: s.status,
        date: s.date,
      })),

      allergies: (visit.allergies || []).map((a) => ({
        allergen: a.allergen,
        reaction: a.reaction,
        severity: a.severity,
      })),

      followups: (visit.followups || []).map((f) => ({
        date: f.date,
        notes: f.notes,
        doctorId: f.doctor_id,
      })),
    };
  }
}

let adapterInstance: TruTechAdapter | null = null;

export function getTruTechAdapter(): TruTechAdapter {
  if (!adapterInstance) {
    adapterInstance = new TruTechAdapter();
  }

  return adapterInstance;
}
