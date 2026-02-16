/**
 * Resolves the Patient source adapter from env (PATIENT_SOURCE).
 * Default: "patient-service" when user-service baseUrl is set in config, else "stub".
 */
import type { PatientSourceAdapter, PatientSourceAdapterKey } from './patient-source.types';
import { createUserServicePatientAdapter } from './user-service.patient.adapter';
import { createStubPatientAdapter } from './stub.patient.adapter';
import { getUserServiceEndpoints } from '../../config/domainEndpoints';

const PATIENT_SOURCE = (process.env.PATIENT_SOURCE ?? '').trim().toLowerCase() as PatientSourceAdapterKey | '';

let cachedAdapter: PatientSourceAdapter | null = null;

function createAdapter(key: PatientSourceAdapterKey): PatientSourceAdapter {
  switch (key) {
    case 'patient-service':
      return createUserServicePatientAdapter();
    case 'stub':
      return createStubPatientAdapter();
    default:
      return createStubPatientAdapter();
  }
}

/**
 * Returns the configured Patient source adapter (cached).
 */
export function getPatientSourceAdapter(): PatientSourceAdapter {
  if (cachedAdapter) return cachedAdapter;
  const userServiceBaseUrl = getUserServiceEndpoints().baseUrl;
  const key: PatientSourceAdapterKey =
    PATIENT_SOURCE === 'patient-service' || PATIENT_SOURCE === 'stub'
      ? PATIENT_SOURCE
      : userServiceBaseUrl
        ? 'patient-service'
        : 'stub';
  cachedAdapter = createAdapter(key);
  return cachedAdapter;
}
