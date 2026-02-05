/**
 * Partner domain types (read-only / shared).
 */

export type PartnerStatus = 'ACTIVE' | 'SUSPENDED';

export type EndpointType = 'API' | 'WEBHOOK' | 'FHIR';

export interface PartnerEndpoint {
  type: EndpointType;
  url: string;
  /** Optional description or environment label */
  description?: string;
}

export interface PartnerMeta {
  partnerId: string;
  name: string;
  status: PartnerStatus;
  /** Optional display / legal name */
  displayName?: string;
  /** Optional description */
  description?: string;
  endpoints?: PartnerEndpoint[];
  createdAt: string;
  updatedAt: string;
}

export interface Partner extends PartnerMeta {
  /** All fields from PartnerMeta; extend here if needed */
}
