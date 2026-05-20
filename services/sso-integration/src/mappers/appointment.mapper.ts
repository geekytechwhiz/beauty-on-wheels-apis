import { Appointment, User } from '../types';
import {
  CreateServiceScheduleRequest,
  GetAvailableServicesRequest,
  RecommendServicesRequest,
  ScheduleCreateRequest,
} from '../types/domain/appointment.types';
import { SSORequestContext } from '../types/common/context.types';
import { ScheduleCreationEventPayload } from '../types/events/schedule-creation-message.types';
import { loadTenantDetails } from '../utils/helper';
export class AppointmentMapper {
  mapAppointmentToSchedule(
    appointment: Appointment,
    doctorUser: User,
    patientUser: User,
    context: SSORequestContext,
  ): ScheduleCreateRequest {
    const startTime = appointment.startTime;
    const endTime = appointment.endTime;
    const scheduleDate = startTime?.split('T')[0] ?? '';
  
    const organizationID =
      patientUser.tenantId || context.integration.subdomain;

    const externalAppointmentId = String(appointment.appointmentId);

    return {
      startTime: startTime ?? '',
      endTime: endTime ?? ''  ,
      scheduleDate,
      appointmentType: 'ONLINE',
      owner: {
        userId: String(doctorUser.id),
        userType: 'STAFF',
      },
      participantInfo: [
        {
          userId: String(doctorUser.id),
          userType: 'STAFF',
          organizationID,
        },
        {
          userId: String(patientUser.id),
          userType: 'USER',
          organizationID,
        },
      ],
      organizationID,
      externalAppointmentId,
      meta: {
        externalAppointmentId,
        consultationType: appointment.consultationType?.name,
        visitId: appointment.visit?.id,
        sourceSystem: context.sourceSystem,
      },
    };
  }

  /**
   * Converts ISO 8601 datetime to 12-hour format with leading zero on hour (e.g. "05:00 PM", "05:15 PM").
   * If the value cannot be parsed, returns it as-is.
   */
  private formatTime12Hour(isoDateTime: string): string {
    const date = new Date(isoDateTime);
    if (isNaN(date.getTime())) {
      return isoDateTime;
    }
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    const hoursStr = hours12.toString().padStart(2, '0');
    const minutesStr = minutes.toString().padStart(2, '0');
    return `${hoursStr}:${minutesStr} ${ampm}`;
  }

  /**
   * Converts ISO 8601 datetime to DD-MM-YYYY format.
   * Falls back to today's date string if parsing fails.
   */
  private formatDateDDMMYYYY(isoDateTime: string): string {
    const date = new Date(isoDateTime);
    if (isNaN(date.getTime())) {
      const now = new Date();
      const day = now.getUTCDate().toString().padStart(2, '0');
      const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
      return `${day}-${month}-${now.getUTCFullYear()}`;
    }
    const day = date.getUTCDate().toString().padStart(2, '0');
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}-${month}-${year}`;
  }

  /**
   * Calculates duration in minutes between two ISO datetime strings.
   * Returns "15" as a safe default when either timestamp cannot be parsed.
   */
  private calculateDurationMinutes(startTime: string, endTime: string): string {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    if (isNaN(start) || isNaN(end) || end <= start) {
      return '15';
    }
    return Math.round((end - start) / (1000 * 60)).toString();
  }

  /**
   * Converts ISO datetime to timestamp string (milliseconds since epoch)
   */
  private getTimestampString(isoDateTime: string): string {
    return new Date(isoDateTime).getTime().toString();
  }

  /**
   * Maps appointment to GetAvailableServicesRequest
   */
  mapAppointmentToGetAvailableServices(
    event: ScheduleCreationEventPayload,
    context: SSORequestContext,
  ): GetAvailableServicesRequest {
    const subdomain = context.integration?.subdomain ?? '';
    const tenant = loadTenantDetails(subdomain);
    const organizationId =
      event.doctor.organizationId ||
      event.patient.organizationId ||
      tenant.organizationId;

    return {
      organizationId,
      assignOrgId: organizationId,
      serviceType: 'addon',
      listingType: 'recommended',
      featureKey: 'doctor_consultancy',
      featureCat: 'consultancy',
    };
  }

  /**
   * Maps appointment to RecommendServicesRequest
   */
  mapAppointmentToRecommendServices(
    event: ScheduleCreationEventPayload,
    orgAddonId: string,
    context: SSORequestContext,
  ): RecommendServicesRequest {
    const subdomain = context.integration?.subdomain;
    const tenant = loadTenantDetails(subdomain);
    // console.log("tenant", tenant);
    // console.log("event", event);
    const organizationID =
    event.doctor.organizationId ||
    event.patient.organizationId ||
    tenant.organizationId;
    const scheduleTimeStamp = this.getTimestampString(
      event.appointment.startTime,
    );
    const durationMinutes = this.calculateDurationMinutes(
      event.appointment.startTime,
      event.appointment.endTime,
    );
    const scheduleDate = this.formatDateDDMMYYYY(event.appointment.startTime);

    return {
      organizationId: organizationID,
      type: 'addon',
      userId: event.patient.userId,
      orgAddonId: orgAddonId,
      assignedDoctorId: event.doctor.userId,
      scheduleBy: scheduleTimeStamp,
      externalAppointment: {
        externalId: event.appointment.externalId,
        startTime: event.appointment.startTime,
        endTime: event.appointment.endTime,
        status: event.appointment.status,
        doctorExternalUserId: event.doctor.externalUserId,
        patientExternalUserId: event.patient.externalUserId,
        durationMinutes,
        scheduleDate,
        tenantId: event.tenantId,
        correlationId: event.correlationId,
      },
    };
  }

  /**
   * Maps appointment to CreateServiceScheduleRequest.
   * Includes tenantId and appointmentExternalId for Scheduler Service idempotency
   * (idempotencyKey = `${tenantId}#${appointmentExternalId}`).
   */
  mapAppointmentToCreateServiceSchedule(
    event: ScheduleCreationEventPayload,
    userAddonId: string
  ): CreateServiceScheduleRequest {
  
    const startTime = this.formatTime12Hour(event.appointment.startTime);
    const endTime = this.formatTime12Hour(event.appointment.endTime);
  
    const scheduleDate = this.formatDateDDMMYYYY(event.appointment.startTime);
  
    const scheduleTimeStamp = this.getTimestampString(
      event.appointment.startTime,
    );
  
    const duration = String(
      this.calculateDurationMinutes(
        event.appointment.startTime,
        event.appointment.endTime,
      ),
    );
  
    const doctorName = event.doctor.name ?? '';
    const doctorEmail = event.doctor.email ?? '';
    const doctorSpecialty = 'general';
  
    const patientName = event.patient.name ?? '';
    const patientEmail = event.patient.email ?? '';
  
    const doctorUserId = event.doctor.userId;
    const patientUserId = event.patient.userId;
  
    return {
      serviceType: 'addon',
  
      userAddonId,
  
      userId: patientUserId,
      userName: patientName,
      userEmail: patientEmail,
  
      staffId: doctorUserId,
      staffName: doctorName,
      staffEmail: doctorEmail,
      staffSpecialty: doctorSpecialty,
  
      startTime,
      endTime,
      duration,
  
      scheduleDate,
      scheduleTimeStamp,
  
      scheduleType: 'ONLINE',
  
      pincode: '134114',
      latitude: 0,
      longitude: 0,
  
      action: 'createSchedule',
      paymentSchedule: 'INSTANT',
    };
  }
}

let appointmentMapperInstance: AppointmentMapper | null = null;

export function getAppointmentMapper(): AppointmentMapper {
  if (!appointmentMapperInstance) {
    appointmentMapperInstance = new AppointmentMapper();
  }
  return appointmentMapperInstance;
}

