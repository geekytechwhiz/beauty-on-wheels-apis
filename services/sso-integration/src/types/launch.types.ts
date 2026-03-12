import { Appointment, User } from './index'  

export type UserRole = 'PATIENT' | 'DOCTOR' | 'SERVICE';

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
    role: UserRole;
    appointmentId?: string | number;
  }
  
  export interface ServiceTokenResult {
    accessToken: string;
    updateToken: string;
    refreshToken: string;
    expiresIn: number;
    userId: string;
    role: UserRole;
  }