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
import { TruTechEMRVisit, TruTechPatientEMRResponse, TruTechVerifyContext, TruTechVerifyResponse,   } from '../types/external/trutech.types';
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

  public mapVerifyResponse(response: TruTechVerifyResponse): TruTechVerifyResponse {
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

 public mapAppointments(appointments: TruTechAppointment[]): Appointment[] {
    this.logger.debug({
      event: 'trutech_map_appointments_start',  
      appointmentCount: appointments?.length ?? 0,
    });
 
    

    const mapped = ( appointments || []).map((appt, index) => {
      this.logger.debug({
        event: 'trutech_normalize_appointment_start',
        index,
        appointmentId: appt.appointment_id,
        hasPatient: !!appt.patient,
        hasDoctor: !!appt.doctor,
        hasConsultationType: !!appt.consultation_type,
        hasVisit: !!appt.visit,
      });

      const normalized = this.normalizeAppointment(appt);

      this.logger.debug({
        event: 'trutech_normalize_appointment_success',
        index,
        appointmentId: normalized.appointmentId,
        patientId: normalized.patient.id,
        doctorId: normalized.doctor.id,
      });

      return normalized;
    });

    this.logger.info({
      event: 'trutech_map_appointments_success',
      appointmentCount: mapped.length,
    });

    return mapped;
  }

  // ---------------------------------------------------------
  // Map EMR Summary
  // ---------------------------------------------------------

  public mapPatientEMRSummary(
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

    const visits = (response.emr || []).map((visit: TruTechEMRVisit) =>
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
      notes: appt.notes ?? '',

      patient: {
        age: appt.patient ? appt.patient.age : null,
        id: appt.patient.id,
        mrn: appt.patient ? appt.patient.mrn : '',
        name: appt.patient ? appt.patient.name : '',
        gender: appt.patient ? appt.patient.gender : '',
        dateOfBirth: appt.patient ? appt.patient.dob : '',
        phone: appt.patient ? appt.patient.phone : '',
        email: appt.patient ? appt.patient.email : '',
        dob: appt.patient ? appt.patient.dob : '',
        organizationId: appt.patient ? appt.patient.organizationId : '',
      } as Patient,

      doctor: {
        id: appt.doctor ? appt.doctor.id : null,
        name: appt.doctor ? appt.doctor.name : null,
        department: appt.doctor ? appt.doctor.department : null,
        phone: appt.doctor ? appt.doctor.phone : null,
        email: appt.doctor ? appt.doctor.email : null,
      } as Doctor,

      consultationType: {
        id: appt.consultation_type.id,
        name: appt.consultation_type.name,
      } as ConsultationType,

      visit: {
        id: appt.visit.id,
        visitType: appt.visit.visit_type as any,
        createdAt: appt.visit.created_at,
        status: appt.visit.status as any,
      } as Visit,
    };
  }

  // ---------------------------------------------------------
  // Normalize EMR Visit
  // ---------------------------------------------------------

  public normalizeEMRVisit(visit: TruTechEMRVisit): EMRVisit {
    return {
      visitId: visit.visit_id,
      visitType: visit.visit_type,
      date: visit.date,

      diagnosis: (visit.diagnosis || []).map((d:any) => ({
        code: d.code,
        name: d.name,
        type: d.type,
      })),

      vitals: (visit.vitals || []).map((v:any) => ({
        name: v.name,
        value: v.value,
        unit: v.unit,
        recordedAt: v.recorded_at,
      })),

      medicines: (visit.medicines || []).map((m:any) => ({
        name: m.name,
        dosage: m.dosage,
        frequency: m.frequency,
        duration: m.duration,
        instructions: m.instructions,
      })),

      investigations: (visit.investigations || []).map((i:any) => ({
        name: i.name,
        result: i.result,
        status: i.status,
        date: i.date,
      })),

      services: (visit.services || []).map((s:any) => ({
        name: s.name,
        status: s.status,
        date: s.date,
      })),

      allergies: (visit.allergies || []).map((a:any) => ({
        allergen: a.allergen,
        reaction: a.reaction,
        severity: a.severity,
      })),

      followups: (visit.followups || []).map((f:any) => ({
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
