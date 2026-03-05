import {  VisitType } from "../enums" 

    export interface Appointment {
    appointmentId: number
    startTime: string
    endTime: string
    status: AppointmentStatus
    notes?: string | null
  
    patient: Patient
    doctor: Doctor
    consultationType: ConsultationType
    visit: Visit
  }
  export interface Patient {
    id: number;
    mrn: string;
    dateOfBirth: string;
    name: string;
    gender: string;
    age: string | null; 
    phone?: string | null;
    phoneCode?: string | null;
    email?: string | null;
    organizationId: string;
    dob: string | null;
  }
  export interface Doctor {
    id: number;
    name: string;
    department?: string;
    phone?: string;
    email?: string;
  }
  
  export enum AppointmentStatus {
    SCHEDULED = 1,
    CHECKED_IN = 2,
    IN_PROGRESS = 3,
    COMPLETED = 4,
    CANCELLED = 5,
    NO_SHOW = 6
  }
 
  export interface ConsultationType {
    id: number;
    name: string;
  }
  export interface Visit {
    id: number;
    visitType: VisitType;
    createdAt: string;
    status: number;
  }

  export interface Diagnosis {
    code?: string;
    name: string;
    type?: string;
  }
  
  export interface Vital {
    name: string;
    value: string;
    unit?: string;
    recordedAt?: string;
  }
  
  export interface Medicine {
    name: string;
    dosage?: string;
    frequency?: string;
    duration?: string;
    instructions?: string;
  }
  
  export interface Investigation {
    name: string;
    result?: string;
    status?: string;
    date?: string;
  }
  
  export interface Service {
    name: string;
    status?: string;
    date?: string;
  }
  
  export interface Allergy {
    allergen: string;
    reaction?: string;
    severity?: string;
  }
  
  export interface Followup {
    date: string;
    notes?: string;
    doctorId?: number;
  }
  
  export interface ConsultationType {
    id: number;
    name: string;
  }