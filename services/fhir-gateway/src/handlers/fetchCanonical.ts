/**
 * Fetches canonical data from apps/* APIs.
 * Environment: USER_SERVICE_URL, DEVICE_SERVICE_URL (or similar).
 * Stub implementation — wire to real HTTP calls in deployment.
 */
import type { Patient, ObservationValue } from '@api-hub/canonical';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL ?? '';
const DEVICE_SERVICE_URL = process.env.DEVICE_SERVICE_URL ?? '';

/**
 * Fetches canonical Patient (user) by id from user-service.
 */
export async function fetchCanonicalPatient(patientId: string): Promise<Patient | null> {
  if (!USER_SERVICE_URL) {
    // Stub for local/dev: return minimal canonical patient
    return {
      id: patientId,
      active: true,
      givenName: 'Stub',
      familyName: 'Patient',
    };
  }
  try {
    const res = await fetch(`${USER_SERVICE_URL}/users/${patientId}`);
    if (!res.ok) return null;
    const user = (await res.json()) as Record<string, unknown>;
    return mapUserToCanonicalPatient(user, patientId);
  } catch {
    return null;
  }
}

function mapUserToCanonicalPatient(
  user: Record<string, unknown>,
  id: string
): Patient {
  return {
    id,
    externalId: user.pk as string | undefined,
    active: user.isActive as boolean | undefined,
    givenName: user.firstName as string | undefined,
    familyName: user.lastName as string | undefined,
    email: user.emailAddress as string | undefined,
    phone: (user.additionalPhoneNumbers as string[])?.[0],
    gender: user.gender as string | undefined,
    birthDate: user.dateOfBirth as string | undefined,
    addressLine: user.address as string | undefined,
    city: user.city as string | undefined,
    country: user.country as string | undefined,
  };
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
