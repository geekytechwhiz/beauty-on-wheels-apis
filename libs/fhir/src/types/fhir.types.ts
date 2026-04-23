export type FhirResource = Record<string, unknown>;

export interface FhirHumanName {
  use?: 'official' | 'usual' | 'temp' | 'nickname' | 'anonymous' | 'old' | 'maiden';
  text?: string;
  prefix?: string[];
  given?: string[];
  family?: string;
}

export interface FhirContactPoint {
  system?: 'phone' | 'fax' | 'email' | 'pager' | 'url' | 'sms' | 'other';
  value?: string;
}

export interface FhirAddress {
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface FhirPatient extends FhirResource {
  resourceType: 'Patient';
  id?: string;
  active?: boolean;
  meta?: { lastUpdated?: string; source?: string };
  identifier?: Array<{ system?: string; value?: string }>;
  name?: FhirHumanName[];
  telecom?: FhirContactPoint[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
  address?: FhirAddress[];
  managingOrganization?: { reference?: string };
}

export interface FhirBundleEntry {
  resource?: FhirResource;
}

export interface FhirBundle extends FhirResource {
  resourceType: 'Bundle';
  type: 'searchset';
  entry?: FhirBundleEntry[];
}

export interface FhirCapabilityStatementResource {
  type: string;
  interaction: Array<{ code: 'read' | 'search-type' | 'create' | string }>;
  supportedProfile?: string[];
}

export interface FhirCapabilityStatement extends FhirResource {
  resourceType: 'CapabilityStatement';
  status: 'active' | string;
  date: string;
  kind: 'instance' | string;
  fhirVersion: string;
  format: string[];
  rest: Array<{
    mode: 'server' | string;
    resource: FhirCapabilityStatementResource[];
  }>;
  implementation?: {
    description: string;
    url: string;
  };
}
