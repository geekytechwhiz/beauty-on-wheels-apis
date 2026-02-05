/**
 * Partner capability types (FHIR / NON_FHIR).
 */

export type InteropMode = 'FHIR' | 'NON_FHIR';

export interface PartnerCapability {
  partnerId: string;
  interopMode: InteropMode;
  /** Optional version or profile */
  version?: string;
  updatedAt: string;
}
