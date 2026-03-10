import { Appointment, User } from './index'  

export type ServiceUserRole = 'PATIENT' | 'DOCTOR' | 'SERVICE';

export interface LaunchProcessParams {
  launchToken: string
}

export interface LaunchProcessResult {

  doctor: User

  appointments: Appointment[]

  patientEventsPublished?: number

  serviceToken: ServiceTokenResult

}

export interface ServiceTokenContext {
    userId: string;
    role: ServiceUserRole;
    appointmentId?: string | number;
  }
  
  export interface ServiceTokenResult {
    token: string;
    expiresIn: number;
    refreshToken: string;
    userId: string;
    role: ServiceUserRole;
  }