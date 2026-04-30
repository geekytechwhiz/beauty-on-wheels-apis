import { Patient } from './Patient';

/**
 * CanonicalPatient is the FHIR-facing canonical representation of a patient.
 *
 * It extends the existing business `Patient` model to avoid breaking domain
 * services, while exposing firstName/lastName/medicalRecordNumber fields for
 * mapping-based FHIR transforms.
 */
export interface CanonicalPatient extends Patient {
  firstName?: string;
  lastName?: string;
  middleName?: string;
  namePrefix?: string;
  medicalRecordNumber?: string;
  /** Alternate MRN field from persistence / APIs */
  mrn?: string;
  phoneNumber?: string;
  phoneCode?: string;
  email?: string;
  emailAddress?: string;
  address?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  zip?: string;
  country?: string;
  gender?: string;
  dateOfBirth?: string;
  userID?: string;
  organizationID?: string;
  isActive?: boolean;
  /** Set by FHIR layer before mapping when `organizationId` is present */
  managingOrganizationReference?: string;
  /** Set by FHIR layer before mapping from phone + phoneCode */
  telecomPhoneValue?: string;
}


