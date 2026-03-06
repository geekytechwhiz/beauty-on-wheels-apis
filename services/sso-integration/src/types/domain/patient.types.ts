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
export interface CreateExternalUserPayload extends Patient {
  externalId: string;
  provider: string;
  tenantId: string;
  role: string;
  source: string;
}