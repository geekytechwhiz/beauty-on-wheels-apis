/**
 * Resolves the Patient source adapter from env (PATIENT_SOURCE).
 * Default: "patient-service" when USER_SERVICE_URL is set, else "stub".
 */
import type { PatientSourceAdapter, PatientSourceAdapterKey } from './patient-source.types';
import { createUserServicePatientAdapter } from './user-service.patient.adapter';
import { StubPatientAdapter } from './stub.patient.adapter';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL ?? '';
const PATIENT_SOURCE = (process.env.PATIENT_SOURCE ?? '').trim().toLowerCase() as PatientSourceAdapterKey | '';

let cachedAdapter: PatientSourceAdapter | null = null;

function createAdapter(key: PatientSourceAdapterKey): PatientSourceAdapter {
  switch (key) {
    case 'patient-service':
      return createUserServicePatientAdapter();
    case 'stub':
      return new StubPatientAdapter();
    default:
      return USER_SERVICE_URL ? createUserServicePatientAdapter() : new StubPatientAdapter();
  }
}

/**
 * Returns the configured Patient source adapter (cached).
 */
export function getPatientSourceAdapter(): PatientSourceAdapter {
  if (cachedAdapter) return cachedAdapter;
  const key: PatientSourceAdapterKey =
    PATIENT_SOURCE === 'patient-service' || PATIENT_SOURCE === 'stub'
      ? PATIENT_SOURCE
      : USER_SERVICE_URL
        ? 'patient-service'
        : 'stub';
  cachedAdapter = createAdapter(key);
  return cachedAdapter;
}
