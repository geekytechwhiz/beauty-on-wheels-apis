import { ConsultationType } from "../domain/appointment.types"

 

export interface TruTechAppointmentsResponse {
    status: 'success' | 'error'
    appointments?: TruTechAppointment[]
    message?: string
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
    email?: string
    organizationId: string
  }
  export interface TruTechDoctor {
    id: number
    name: string
    department?: string
    phone?: string
    email?: string
  }

  export interface TruTechVisit {
    id: number
    visit_type: number
    created_at: string
    status: number
  }

  export interface TruTechDoctor {
    id: number
    name: string
    department?: string
    phone?: string
    email?: string
  }