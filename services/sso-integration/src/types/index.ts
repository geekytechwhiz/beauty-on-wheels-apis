// =============================================================================
// TruTech API Types - Based on TeleconsultationController API Specification
// =============================================================================

// -----------------------------------------------------------------------------
// Verify Token API Types
// -----------------------------------------------------------------------------

export interface TruTechVerifyRequest {
  launch_token: string;
}

export interface TruTechVerifyResponse {
  status: 'success' | 'error';
  doctor_uid?: string;
  context?: TruTechVerifyContext;
  message?: string;
}

export interface TruTechVerifyContext {
  tenant_id: string;
  doctor_id: number;
  clinic_id?: string;
  session_id?: string;
  doctor_name?: string;
  doctor_email?: string;
  doctor_phone?: string;
  specialization?: string;
  department?: string;
  expires_at?: string;
}

export interface TruTechVerifiedPayload {
  doctorUid: string;
  doctorId: number;
  doctorName?: string;
  doctorEmail?: string;
  doctorPhone?: string;
  specialization?: string;
  department?: string;
  tenantId: string;
  clinicId?: string;
  sessionId?: string;
  expiresAt?: string;
}

// -----------------------------------------------------------------------------
// Today's Appointments API Types
// -----------------------------------------------------------------------------

export interface TruTechAppointmentsRequest {
  doctor_id: number;
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

// Normalized appointment type for internal use
export interface Appointment {
  appointmentId: number;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  notes?: string;
  patient: Patient;
  doctor: Doctor;
  consultationType: ConsultationType;
  visit: Visit;
}

export interface Patient {
  id: number;
  mrn: string;
  name: string;
  gender: string;
  age: string;
  dateOfBirth: string;
  phone?: string;
  email?: string;
}

export interface Doctor {
  id: number;
  name: string;
  department?: string;
  phone?: string;
  email?: string;
}

export interface ConsultationType {
  id: number;
  name: string;
}

export interface Visit {
  id: number;
  visitType: VisitType;
  createdAt: string;
  status: VisitStatus;
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

export interface User {
  id: string;
  externalId: string;
  provider: string;
  tenantId: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING';
  cognitoUsername?: string;
  doctorId?: number;
  partnerSource?: string;
  launchSource?: string;
  createdAt: string;
  updatedAt: string;
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
  appointments: Appointment[];
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

export enum SSOErrorCode {
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_VERIFICATION_FAILED = 'TOKEN_VERIFICATION_FAILED',
  USER_INACTIVE = 'USER_INACTIVE',
  USER_SERVICE_ERROR = 'USER_SERVICE_ERROR',
  ROLE_SERVICE_ERROR = 'ROLE_SERVICE_ERROR',
  COGNITO_AUTH_ERROR = 'COGNITO_AUTH_ERROR',
  DOWNSTREAM_SERVICE_ERROR = 'DOWNSTREAM_SERVICE_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  INVALID_REQUEST = 'INVALID_REQUEST',
  TRU_TECH_SERVICE_ERROR = 'TRU_TECH_SERVICE_ERROR',
}

export class SSOError extends Error {
  public readonly code: SSOErrorCode;
  public readonly statusCode: number;
  public override readonly cause?: Error;

  constructor(
    code: SSOErrorCode,
    message: string,
    statusCode = 500,
    cause?: Error
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.cause = cause;
    this.name = 'SSOError';
    Error.captureStackTrace(this, this.constructor);
  }

  static invalidToken(message = 'Invalid or malformed launch token'): SSOError {
    return new SSOError(SSOErrorCode.INVALID_TOKEN, message, 400);
  }

  static verificationFailed(message = 'Token verification failed'): SSOError {
    return new SSOError(SSOErrorCode.TOKEN_VERIFICATION_FAILED, message, 401);
  }

  static userInactive(message = 'User account is inactive'): SSOError {
    return new SSOError(SSOErrorCode.USER_INACTIVE, message, 403);
  }

  static userServiceError(message: string, cause?: Error): SSOError {
    return new SSOError(SSOErrorCode.USER_SERVICE_ERROR, message, 503, cause);
  }

  static roleServiceError(message: string, cause?: Error): SSOError {
    return new SSOError(SSOErrorCode.ROLE_SERVICE_ERROR, message, 503, cause);
  }

  static cognitoAuthError(message: string, cause?: Error): SSOError {
    return new SSOError(SSOErrorCode.COGNITO_AUTH_ERROR, message, 503, cause);
  }

  static downstreamError(message: string, cause?: Error): SSOError {
    return new SSOError(SSOErrorCode.DOWNSTREAM_SERVICE_ERROR, message, 503, cause);
  }

  static rateLimitExceeded(message = 'Rate limit exceeded'): SSOError {
    return new SSOError(SSOErrorCode.RATE_LIMIT_EXCEEDED, message, 429);
  }

  static internalError(message: string, cause?: Error): SSOError {
    return new SSOError(SSOErrorCode.INTERNAL_ERROR, message, 500, cause);
  }

  static unauthorized(message = 'Unauthorized'): SSOError {
    return new SSOError(SSOErrorCode.UNAUTHORIZED, message, 401);
  }

  static forbidden(message = 'Access denied'): SSOError {
    return new SSOError(SSOErrorCode.FORBIDDEN, message, 403);
  }

  static notFound(message = 'Resource not found'): SSOError {
    return new SSOError(SSOErrorCode.NOT_FOUND, message, 404);
  }

  static invalidRequest(message: string): SSOError {
    return new SSOError(SSOErrorCode.INVALID_REQUEST, message, 400);
  }

  static truTechServiceError(message: string, cause?: Error): SSOError {
    return new SSOError(SSOErrorCode.TRU_TECH_SERVICE_ERROR, message, 503, cause);
  }
}

export interface ServiceClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface RateLimitState {
  count: number;
  resetAt: number;
}
