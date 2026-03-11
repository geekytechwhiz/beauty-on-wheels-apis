import { Appointment, User } from '../types';
import { UserSourceSystem } from '../types/integration.types';
import { 
  ScheduleCreateRequest,
  GetAvailableServicesRequest,
  RecommendServicesRequest,
  CreateServiceScheduleRequest,
} from '../types/appointment-sync.types';
import { CONSTANTS } from '../utils/constants';
import { CognitoUserContext } from '../types/user/user.types';
export class AppointmentMapper {
  mapAppointmentToSchedule(
    appointment: Appointment,
    doctorUser: User,
    patientUser: User,
  ): ScheduleCreateRequest {
    const startTime = appointment.startTime;
    const endTime = appointment.endTime;
    const scheduleDate = startTime.split('T')[0];

    const organizationID =
      patientUser.organizationId || appointment.patient.organizationId;

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
        sourceSystem: UserSourceSystem.AFRICA_HMS,
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
    appointment: Appointment,
    patientUser: User,
  ): GetAvailableServicesRequest {
    const organizationID =
      patientUser.organizationId || appointment.patient.organizationId;

    return {
      organizationId: organizationID || CONSTANTS.ORGANIZATION_ID,
      assignOrgId: organizationID || CONSTANTS.ORGANIZATION_ID,
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
    appointment: Appointment,
    doctorUser: CognitoUserContext,
    patientUser: User,
    orgAddonId: string,
  ): RecommendServicesRequest {
    const organizationID =
    patientUser.organizationId || appointment.patient.organizationId || CONSTANTS.ORGANIZATION_ID;
    console.log("PATIENT USER: ", patientUser);
    console.log("APPOINTMENT: ", appointment);
    console.log("DOCTOR USER: ", doctorUser);
    console.log("ORG ADDON ID: ", orgAddonId);
    console.log("ORGANIZATION ID: ", organizationID);
  
    const scheduleTimeStamp = this.getTimestampString(appointment.startTime);

    return {
      organizationId: organizationID,
      type: 'addon',
      userId: String(patientUser.id),
      orgAddonId: orgAddonId,
      assignedDoctorId: String(doctorUser.userId),
      scheduleBy: scheduleTimeStamp,
    };
    
  }

  /**
   * Maps appointment to CreateServiceScheduleRequest
   */
  mapAppointmentToCreateServiceSchedule(
    appointment: Appointment,
    doctorUser: CognitoUserContext,
    patientUser: User,
    userAddonId: string,
  ): CreateServiceScheduleRequest {
    const organizationID =
      patientUser.organizationId || appointment.patient.organizationId;

    const startTime = this.formatTime12Hour(appointment.startTime);
    const endTime = this.formatTime12Hour(appointment.endTime);
    const scheduleDate = this.formatDateDDMMYYYY(appointment.startTime);
    const scheduleTimeStamp = this.getTimestampString(appointment.startTime);
    const duration = this.calculateDurationMinutes(
      appointment.startTime,
      appointment.endTime,
    );

    // Extract doctor information
    const doctorName = appointment.doctor.name || '';
    const doctorEmail = appointment.doctor.email || '';
    const doctorSpecialty = appointment.doctor.department || 'general';

    // Extract patient information
    const patientName = appointment.patient.name || '';
    const patientEmail = appointment.patient.email || '';

    return {
      serviceType: 'addon',
      userAddonId: userAddonId,
      userId: String(patientUser.id),
      userName: patientName,
      userEmail: patientEmail,
      staffId: String(doctorUser.userId),
      staffName: doctorName,
      staffEmail: doctorEmail,
      staffSpecialty: doctorSpecialty,
      startTime: startTime,
      endTime: endTime,
      duration: duration,
      scheduleDate: scheduleDate,
      scheduleTimeStamp: scheduleTimeStamp,
      scheduleType: 'ONLINE',
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

