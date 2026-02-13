/**
 * Fetches canonical data from apps/* APIs.
 * Patient is resolved via adapters (see adapters/patient); Observations use DEVICE_SERVICE_URL.
 */
import type { ObservationValue } from '@api-hub/canonical';
import { getPatientSourceAdapter } from '../adapters/patient';
import type { PatientFetchResult } from '../adapters/patient';

const DEVICE_SERVICE_URL = process.env.DEVICE_SERVICE_URL ?? '';

/** Options when fetching a patient (e.g. headers to forward to the backing API). */
export interface FetchCanonicalPatientOptions {
  headers?: Record<string, string>;
}

/**
 * Fetches canonical Patient by id using the configured patient source adapter
 * (user-service microservice or stub when USER_SERVICE_URL is unset).
 * Returns canonical + optional raw domain response for response merge.
 */
export async function fetchCanonicalPatient(
  patientId: string,
  options?: FetchCanonicalPatientOptions
): Promise<PatientFetchResult | null> {
  const adapter = getPatientSourceAdapter();
  return adapter.getPatient(patientId, { headers: options?.headers });
}

/**
 * Fetches canonical observations for a patient (e.g. from device-service or a dedicated read API).
 */
export async function fetchCanonicalObservations(
  patientId: string
): Promise<ObservationValue[]> {
  if (!DEVICE_SERVICE_URL) {
    return [];
  }
  try {
    const res = await fetch(
      `${DEVICE_SERVICE_URL}/observations?patientId=${encodeURIComponent(patientId)}`
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: unknown[] };
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map((o: unknown) =>
      mapToCanonicalObservation(o as Record<string, unknown>, patientId)
    );
  } catch {
    return [];
  }
}

function mapToCanonicalObservation(
  o: Record<string, unknown>,
  subjectId: string
): ObservationValue {
  return {
    id: (o.id as string) ?? String(o.effectiveDateTime ?? ''),
    subjectId,
    effectiveDateTime: (o.effectiveDateTime as string) ?? new Date().toISOString(),
    code: o.code as string | undefined,
    display: o.display as string | undefined,
    system: o.system as string | undefined,
    valueQuantity: o.valueQuantity as ObservationValue['valueQuantity'],
    valueCodeableConcept: o.valueCodeableConcept as ObservationValue['valueCodeableConcept'],
    status: (o.status as ObservationValue['status']) ?? 'final',
    deviceReadingId: o.deviceReadingId as string | undefined,
  };
}
