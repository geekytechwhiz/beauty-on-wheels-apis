export interface Visit {
    id: number
    visitType: VisitType
    createdAt: string
    status: number
  }
  
  export enum VisitType {
    OUTPATIENT = 1,
    INPATIENT = 2,
    EMERGENCY = 3,
    TELECONSULTATION = 4
  }
  
  export enum VisitStatus {
    ACTIVE = 1,
    COMPLETED = 2,
    CANCELLED = 3
  }