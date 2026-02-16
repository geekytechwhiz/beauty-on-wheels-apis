/**
 * Patient source adapter that calls an existing user/patient microservice.
 * Maps the service response to canonical Patient for FHIR exposure.
 * Domain API URL and endpoint come from config (see config/domainEndpoints).
 */
import type { Patient } from '@api-hub/canonical';
import type { GetPatientOptions, PatientSourceAdapter } from './patient-source.types';
import type { UserServiceEndpointConfig } from '../../config/domainEndpoints';
import { getUserServiceEndpoints } from '../../config/domainEndpoints';

export interface UserServicePatientAdapterConfig {
  baseUrl: string;
  /** Path + optional query, e.g. "get-user-details?userID={id}" or "/users/{id}". */
  pathTemplate?: string;
}

function defaultPath(id: string): string {
  return `/users/${id}`;
}

/** Normalize DD-MM-YYYY or similar to FHIR date (YYYY-MM-DD) when possible. */
function normalizeBirthDate(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  const parts = s.split(/[-./]/);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (a.length === 4 && b.length <= 2 && c.length <= 2) return s;
    if (c.length === 4 && a.length <= 2 && b.length <= 2) return `${c}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
    if (b.length === 4 && a.length <= 2 && c.length <= 2) return `${b}-${a.padStart(2, '0')}-${c.padStart(2, '0')}`;
  }
  return s;
}

/**
 * Maps get-user-details (or similar) response to canonical Patient for FHIR mapping.
 * Raw response is kept as-is for the HTTP body; canonical is used to build FHIR fields (name, gender, birthDate, address, telecom, etc.).
 */
export function mapUserServiceResponseToCanonical(
  raw: Record<string, unknown>,
  id: string
): Patient {
  return {
    id: (raw.userID as string) ?? id,
    externalId: (raw.mrn ?? raw.userID ?? raw.pk ?? raw.id) as string | undefined,
    active: (raw.isActive ?? raw.active) as boolean | undefined,
    givenName: (raw.firstName ?? raw.givenName) as string | undefined,
    familyName: (raw.lastName ?? raw.familyName) as string | undefined,
    email: (raw.emailAddress ?? raw.email) as string | undefined,
    phone: (raw.phoneNumber ?? (Array.isArray(raw.additionalPhoneNumbers) ? (raw.additionalPhoneNumbers as string[])[0] : undefined) ?? raw.phone) as string | undefined,
    gender: (raw.gender) as string | undefined,
    birthDate: normalizeBirthDate(raw.dateOfBirth ?? raw.birthDate),
    addressLine: ([raw.street, raw.address].filter(Boolean) as string[]).join(', ') || (raw.address as string | undefined),
    city: (raw.city) as string | undefined,
    state: (raw.state) as string | undefined,
    postalCode: (raw.zip ?? raw.postalCode ?? raw.postal_code) as string | undefined,
    country: (raw.country) as string | undefined,
    organizationId: (raw.organizationID ?? raw.organizationId) as string | undefined,
    createdAt: (raw.createdAt ?? raw.created_at) as string | undefined,
    updatedAt: (raw.updatedAt ?? raw.updated_at) as string | undefined,
  };
}

export class UserServicePatientAdapter implements PatientSourceAdapter {
  constructor(private readonly config: UserServicePatientAdapterConfig) {}

  async getPatient(id: string, options?: GetPatientOptions) {
    const base = this.config.baseUrl.replace(/\/$/, '');
    const path = this.config.pathTemplate
      ? this.config.pathTemplate.replace(/\{id\}/g, encodeURIComponent(id))
      : defaultPath(id);
    const url = path.startsWith('http') ? path : `${base}/${path.replace(/^\//, '')}`;

    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      ...options?.headers,
    };

    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, unknown>;
      const canonical = mapUserServiceResponseToCanonical(data, id);
      return { canonical, raw: data };
    } catch {
      return null;
    }
  }
}

/** Factory: build adapter from domain config (config/domainEndpoints). */
export function createUserServicePatientAdapter(
  config?: UserServiceEndpointConfig
): PatientSourceAdapter {
  const endpoints = config ?? getUserServiceEndpoints();
  if (!endpoints.baseUrl) {
    throw new Error('USER_SERVICE_URL is required for user-service patient adapter');
  }
  return new UserServicePatientAdapter({
    baseUrl: endpoints.baseUrl,
    pathTemplate: endpoints.patientPath || undefined,
  });
}
