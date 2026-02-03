/**
 * Canonical Patient model — pure business representation.
 * No FHIR imports or profile references.
 */
export interface Patient {
  id: string;
  /** External/customer identifier */
  externalId?: string;
  active?: boolean;
  /** Human name parts */
  givenName?: string;
  familyName?: string;
  /** Contact */
  email?: string;
  phone?: string;
  /** Demographics */
  gender?: string;
  birthDate?: string;
  /** Address */
  addressLine?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  /** Meta */
  createdAt?: string;
  updatedAt?: string;
  organizationId?: string;
}
