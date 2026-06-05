import { ConsultationType } from "../domain/appointment.types";

 

export interface TruTechAppointmentsResponse {
    status: 'success' | 'error'
    appointments?: TruTechAppointment[]
    message?: string
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
  export interface TruTechVerifyResponse { 
    doctor_uid: string;
    context: TruTechVerifyContext;
    message?: string;
    status?: string;
  }
  export interface TruTechAppointment {
    appointment_id: number
    start_time: string
    end_time: string
    status: number
    notes?: string
  
    patient: TruTechPatient
    doctor: TruTechDoctor
    consultation_type: ConsultationType
    visit: TruTechVisit
  }
  export interface TruTechPatient {
    id: number
    mrn: string
    name: string
    gender: string
    age: string
    dob: string
    phone?: string
    region_code?: string
    email?: string
    organizationId: string
  }
  export interface TruTechDoctor {
    id: number
    name: string
    department?: string
    phone?: string
    region_code?: string
    email?: string
  }

  export interface TruTechVisit {
    id: number
    visit_type: number
    created_at: string
    status: number
  }

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
   