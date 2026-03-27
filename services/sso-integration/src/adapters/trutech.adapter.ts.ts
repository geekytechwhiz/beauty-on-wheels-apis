import { createLogger, createChildLogger } from '@api-hub/logger';

import {
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
import { TruTechEMRVisit, TruTechPatientEMRResponse } from '../types/external/trutech.types';
import { SSOError } from '../types/errors/sso-error';
import { getEnvConfig } from '../config/env';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

export class TruTechAdapter {
  private readonly logger = createChildLogger(baseLogger, {
    component: 'TruTechAdapter',
  });
  private readonly appointmentSourceTimezone: string;

  constructor() {
    const env = getEnvConfig();
    this.appointmentSourceTimezone = env.APPOINTMENT_SOURCE_TIMEZONE || 'Africa/Lusaka';
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
    const startTimeUtc = this.convertSourceLocalToUtcIso(appt.start_time);
    const endTimeUtc = this.convertSourceLocalToUtcIso(appt.end_time);
    const visitCreatedAtUtc = this.convertSourceLocalToUtcIso(
      appt.visit?.created_at ?? '',
    );

    return {
      appointmentId: appt.appointment_id,
      startTime: startTimeUtc,
      endTime: endTimeUtc,
      status: appt.status as AppointmentStatus,
      notes: appt.notes ?? '',

      patient: {
        age: appt.patient ? appt.patient.age : null,
        id: appt.patient ? appt.patient.id : null,
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
        id: appt.consultation_type?.id ?? null,
        name: appt.consultation_type?.name ?? '',
      } as ConsultationType,

      visit: {
        id: appt.visit?.id ?? null,
        visitType: (appt.visit?.visit_type ?? null) as any,
        createdAt: visitCreatedAtUtc || null,
        status: (appt.visit?.status ?? null) as any,
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

  /**
   * Convert HMS datetime to UTC ISO string.
   * Treat incoming HMS values as local clock time in configured source timezone
   * and convert to UTC ISO for downstream processing.
   */
  private convertSourceLocalToUtcIso(dateTime: string): string {
    const raw = String(dateTime ?? '').trim();
    if (!raw) {
      return raw;
    }

    const normalized = raw.replace(' ', 'T');
    const match = normalized.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.(\d{1,6}))?)?(?:Z|[+-]\d{2}:\d{2})?$/,
    );

    if (!match) {
      this.logger.warn({
        event: 'trutech_timezone_parse_fallback',
        rawDateTime: raw,
      });
      return raw;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] ?? '0');
    const fraction = (match[8] ?? '').padEnd(3, '0').slice(0, 3);
    const millisecond = Number(fraction || '0');

    const naiveUtcMillis = Date.UTC(
      year,
      month - 1,
      day,
      hour,
      minute,
      second,
      millisecond,
    );

    const offsetMsFirstPass =
      this.getTimeZoneOffsetMs(
        this.appointmentSourceTimezone,
        naiveUtcMillis,
      );
    let utcMillis = naiveUtcMillis - offsetMsFirstPass;

    // Re-evaluate once at corrected instant for timezone rules stability.
    const offsetMsSecondPass =
      this.getTimeZoneOffsetMs(
        this.appointmentSourceTimezone,
        utcMillis,
      );
    utcMillis = naiveUtcMillis - offsetMsSecondPass;

    return new Date(utcMillis).toISOString();
  }

  private getTimeZoneOffsetMs(timeZone: string, utcMillis: number): number {
    const dtf = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = dtf.formatToParts(new Date(utcMillis));
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

    const tzAsUtc = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second),
      0,
    );

    const utcWithoutMs = utcMillis - (utcMillis % 1000);
    return tzAsUtc - utcWithoutMs;
  }
}

let adapterInstance: TruTechAdapter | null = null;

export function getTruTechAdapter(): TruTechAdapter {
  if (!adapterInstance) {
    adapterInstance = new TruTechAdapter();
  }

  return adapterInstance;
}
