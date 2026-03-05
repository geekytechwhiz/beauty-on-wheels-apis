export interface Patient {
    id: number
    mrn: string
    name: string
    gender: string
    age: string | null
    dateOfBirth: string
    dob: string | null
    phone?: string | null
    phoneCode?: string | null
    email?: string | null
    organizationId: string
  }