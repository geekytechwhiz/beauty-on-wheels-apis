import { Allergy, ConsultationType, Diagnosis, Followup, Investigation, Medicine, Service, Vital } from "./domain/appointment.types"

 

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
    integration?: {
      providerId: string;
      subdomain: string;
      externalHospitalId?: string;
    }
  }
 
export interface TruTechVerifyRequest {
    launch_token: string;
  }
  
  export interface TruTechVerifyResponse { 
    doctor_uid: string;
    context: TruTechVerifyContext;
    message?: string;
    status?: string;
  }
  
  export interface TruTechVerifyContext {
    tenant_id: string;
    drid: number;
    clinic_id?: string;
    session_id?: string;
    name: string;
    email: string;
    doctor_phone?: string;
    specialization?: string;
    department?: string;
    expires_at?: string;
    id: number; 
    phone: string; 
  }
  
  export interface TruTechVerifiedPayload {
    organizationId: string;
    doctorUid: string;
    doctorId: number;
    tenantSubdomain: string;
    doctorName?: string;
    doctorEmail: string;
    doctorPhone?: string;
    specialization?: string;
    department?: string;
    tenantId: string;
    clinicId?: string;
    sessionId?: string;
    expiresAt?: string;
    cognitoUsername?: string;
  }
   
  export interface TruTechAppointmentsResponse {
    status: 'success' | 'error';
    appointments?: TruTechAppointment[];
    message?: string;
  }
  
  export interface TruTechAppointment {
    appointment_id: number;
    start_time: string;
    end_time: string;
    status: number;
    notes?: string;
    patient: TruTechPatient;
    doctor: TruTechDoctor;
    consultation_type: TruTechConsultationType;
    visit: TruTechVisit;
  }
  
  export interface TruTechPatient {
    id: number;
    mrn: string;
    name: string;
    gender: string;
    age: string;
    dob: string;
    phone?: string;
    email?: string;
    organizationId: string;
  }
  
  export interface TruTechDoctor {
    id: number;
    name: string;
    department?: string;
    phone?: string;
    email?: string;
  }
  
  export interface TruTechConsultationType {
    id: number;
    name: string;
  }
  
  export interface TruTechVisit {
    id: number;
    visit_type: number;
    created_at: string;
    status: number;
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
  

  
  export interface Visit {
    id: number;
    visitType: VisitType;
    createdAt: string;
    status: number;
  }
  
  export enum AppointmentStatus {
    SCHEDULED = 1,
    CHECKED_IN = 2,
    IN_PROGRESS = 3,
    COMPLETED = 4,
    CANCELLED = 5,
    NO_SHOW = 6,
  }
  
  export enum VisitType {
    OUTPATIENT = 1,
    INPATIENT = 2,
    EMERGENCY = 3,
    TELECONSULTATION = 4,
  }
  
  export enum VisitStatus {
    ACTIVE = 1,
    COMPLETED = 2,
    CANCELLED = 3,
  }
  
  // -----------------------------------------------------------------------------
  // Patient EMR Summary API Types
  // -----------------------------------------------------------------------------
  
  export interface TruTechPatientEMRRequest {
    patient_id: number;
  }
  
  export interface TruTechPatientEMRResponse {
    status: 'success' | 'error';
    patient_id?: number;
    emr?: TruTechEMRVisit[];
    message?: string;
  }
  
  export interface TruTechEMRVisit {
    visit_id: number;
    visit_type: string;
    date: string;
    diagnosis?: TruTechDiagnosis[];
    vitals?: TruTechVital[];
    medicines?: TruTechMedicine[];
    investigations?: TruTechInvestigation[];
    services?: TruTechService[];
    allergies?: TruTechAllergy[];
    followups?: TruTechFollowup[];
  }
  export interface RequestContext {
    correlationId: string
    tenantId?: string
    userId?: string
  }
  export interface TruTechDiagnosis {
    code?: string;
    name: string;
    type?: string;
  }
  
  export interface TruTechVital {
    name: string;
    value: string;
    unit?: string;
    recorded_at?: string;
  }
  
  export interface TruTechMedicine {
    name: string;
    dosage?: string;
    frequency?: string;
    duration?: string;
    instructions?: string;
  }
  
  export interface TruTechInvestigation {
    name: string;
    result?: string;
    status?: string;
    date?: string;
  }
  
  export interface TruTechService {
    name: string;
    status?: string;
    date?: string;
  }
  
  export interface TruTechAllergy {
    allergen: string;
    reaction?: string;
    severity?: string;
  }
  
  export interface TruTechFollowup {
    date: string;
    notes?: string;
    doctor_id?: number;
  }
  
  // Normalized EMR types for internal use
  export interface PatientEMRSummary {
    patientId: number;
    visits: EMRVisit[];
  }
  
  export interface EMRVisit {
    visitId: number;
    visitType: string;
    date: string;
    diagnosis: Diagnosis[];
    vitals: Vital[];
    medicines: Medicine[];
    investigations: Investigation[];
    services: Service[];
    allergies: Allergy[];
    followups: Followup[];
  }
  
  // -----------------------------------------------------------------------------
  // API Response Types
  // -----------------------------------------------------------------------------
  
  export interface AppointmentsResponse {
    success: true;
    data: {
      appointments: Appointment[];
      count: number;
      date: string;
    };
  }
  
  export interface PatientEMRResponse {
    success: true;
    data: PatientEMRSummary;
  }
  
  export type AppointmentsAPIResponse = AppointmentsResponse | SSOErrorResponse;
  export type PatientEMRAPIResponse = PatientEMRResponse | SSOErrorResponse;
  
  export interface UserLookupParams {
    provider: string;
    externalId: string;
    tenantId: string;
  }
   
  
  export interface CreateUserPayload {
    externalId: string;
    provider: string;
    tenantId: string;
    role: string;
    source: string;
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
  }
  
  export interface RoleAssignmentPayload {
    userId: string;
    roleCode: string;
  }
  
  export interface RoleAssignment {
    id: string;
    userId: string;
    roleCode: string;
    assignedAt: string;
  }
  
  export interface CognitoTokens {
    accessToken: string;
    idToken: string;
    refreshToken: string;
    expiresIn: number;
    tokenType: string;
  }
  
  // -----------------------------------------------------------------------------
  // Teleconsultation DTOs
  // -----------------------------------------------------------------------------
  
  export interface TeleconsultationDetails {
    doctorId: number;
    tenantId: string;
    appointments: TruTechAppointment[];
    emrSummaries: PatientEMRSummary[];
  }
  
  export interface SSOLaunchResponse {
    success: true;
    data: {
      tokens: CognitoTokens;
      redirectUrl: string;
      teleconsultation: TeleconsultationDetails;
      user: {
        id: string;
        externalId: string;
        provider: string;
        tenantId: string;
        doctorId: number;
      };
    };
  }
  
  export interface SSOErrorResponse {
    success: false;
    error: {
      code: string;
      message: string;
      requestId?: string;
    };
  }
  
  export type SSOResponse = SSOLaunchResponse | SSOErrorResponse;
  
  
  export interface ServiceClientConfig {
    baseUrl: string;
    apiKey: string;
    token?: string;
    correlationId: string;
    timeoutMs?: number;
  }
  
  export interface RateLimitState {
    count: number;
    resetAt: number;
  }
  
  // -----------------------------------------------------------------------------
  // Invite Error Types
  // -----------------------------------------------------------------------------
  
  export interface InviteErrorResponse {
    success: false;
    error: {
      code: string;
      message: string;
      requestId?: string;
    };
  }
  
  
