import { SSORequestContext } from "../common/context.types"
import { DoctorCreationPayload, PatientCreationPayload } from "../user-creation.types" 
import { User } from "../user/user.types"

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

export interface SsoUserServiceClient {
  findByExternalId: (
    criteria: {
      provider: string;
      externalId: string;
      tenantId: string;
    },
    context: SSORequestContext,
  ) => Promise<User | null>;

  createDoctorUser: (
    payload: DoctorCreationPayload,
    context: SSORequestContext,
  ) => Promise<User>;

  createPatient: (
    payload: PatientCreationPayload,
     
    context: SSORequestContext,
  ) => Promise<User>;
};