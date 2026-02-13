/**
 * Patient source adapter: abstract how canonical Patient data is fetched.
 * Enables swapping backends (existing microservice, mock, another API) without changing handlers.
 */
import type { Patient } from '@api-hub/canonical';

/** Optional headers to forward to the backing API (e.g. Authorization, Accept). */
export interface GetPatientOptions {
  headers?: Record<string, string>;
}

/** Result of fetching a patient: canonical for FHIR mapping; raw for response merge (domain keys as-is). */
export interface PatientFetchResult {
  canonical: Patient;
  /** Raw API response to merge into the HTTP response (domain keys preserved). Omit for stub. */
  raw?: Record<string, unknown>;
}

export interface PatientSourceAdapter {
  /** Fetch canonical Patient by id; null if not found. Returns canonical + optional raw for response merge. */
  getPatient(id: string, options?: GetPatientOptions): Promise<PatientFetchResult | null>;
}

export type PatientSourceAdapterKey = 'patient-service' | 'stub';
