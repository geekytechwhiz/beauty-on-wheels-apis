import { Diagnosis, Vital, Medicine, Investigation, Service, Allergy, Followup } from "./appointment.types"

 

export interface PatientEMRSummary {
    patientId: number
    visits: EMRVisit[]
  }
  
  export interface EMRVisit {
    visitId: number
    visitType: string
    date: string
    diagnosis: Diagnosis[]
    vitals: Vital[]
    medicines: Medicine[]
    investigations: Investigation[]
    services: Service[]
    allergies: Allergy[]
    followups: Followup[]
  }