import { Appointment, User } from '../types';
import {
  CreateServiceScheduleRequest,
  GetAvailableServicesRequest,
  RecommendServicesRequest,
  ScheduleCreateRequest,
} from '../types/domain/appointment.types';
import { SSORequestContext } from '../types/common/context.types';
import { CreatedUserInfo } from '../types/user/user.types';
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
    const scheduleDate = startTime.split('T')[0];
  
    const organizationID =
      patientUser.tenantId || context.integration.subdomain;

    const externalAppointmentId = String(appointment.appointmentId);

    return {
      startTime,
      endTime,
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
   * Converts ISO 8601 time to 12-hour format (e.g., "11:40 AM")
   */
  private formatTime12Hour(isoDateTime: string): string {
    const date = new Date(isoDateTime);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    const minutesStr = minutes.toString().padStart(2, '0');
    return `${hours12}:${minutesStr} ${ampm}`;
  }

  /**
   * Converts ISO 8601 date to DD-MM-YYYY format
   */
  private formatDateDDMMYYYY(isoDateTime: string): string {
    const date = new Date(isoDateTime);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  }

  /**
   * Calculates duration in minutes between two ISO datetime strings
   */
  private calculateDurationMinutes(startTime: string, endTime: string): string {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const durationMs = end - start;
    const durationMinutes = Math.round(durationMs / (1000 * 60));
    return durationMinutes.toString();
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
    const subdomain = context.integration?.subdomain
    const tenant = loadTenantDetails(subdomain);
    console.log("tenant", tenant);
    console.log("event", event);
    const organizationID =
    event.doctor.organizationId ||
    event.patient.organizationId ||
    tenant.organizationId;
    const scheduleTimeStamp = this.getTimestampString(
      event.appointment.startTime,
    );

    return {
      organizationId: organizationID,
      type: 'addon',
      userId: event.patient.userId,
      orgAddonId: orgAddonId,
      assignedDoctorId: event.doctor.userId,
      scheduleBy: scheduleTimeStamp,
    };
  }

  /**
   * Maps appointment to CreateServiceScheduleRequest.
   * Includes tenantId, appointmentExternalId, doctorUserId, patientUserId for Scheduler Service idempotency
   * (idempotencyKey = `${tenantId}#${appointmentExternalId}`).
   */
  mapAppointmentToCreateServiceSchedule(
    event: ScheduleCreationEventPayload,
    userAddonId: string,
    context: SSORequestContext,
  ): CreateServiceScheduleRequest {
    const startTime = this.formatTime12Hour(event.appointment.startTime);
    const endTime = this.formatTime12Hour(event.appointment.endTime);
    const scheduleDate = this.formatDateDDMMYYYY(event.appointment.startTime);
    const scheduleTimeStamp = this.getTimestampString(
      event.appointment.startTime,
    );
    const duration = this.calculateDurationMinutes(
      event.appointment.startTime,
      event.appointment.endTime,
    );

    const doctorName = '';
    const doctorEmail = '';
    const doctorSpecialty = 'general';
    const patientName = '';
    const patientEmail = '';

    const tenantId = context.integration?.subdomain ?? context.tenantId ?? '';
    const appointmentExternalId = event.appointment.externalId;
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
      action: 'createSchedule',
      paymentSchedule: 'INSTANT',
      tenantId,
      appointmentExternalId,
      doctorUserId,
      patientUserId,
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

