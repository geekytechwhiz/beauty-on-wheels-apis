import type { GetPatientOptions, PatientSourceAdapter } from './patient-source.types';

/** Stub adapter when no user-service URL is configured (e.g. local dev). Always returns null. */
export class StubPatientAdapter implements PatientSourceAdapter {
  async getPatient(_id: string, _options?: GetPatientOptions) {
    return null;
  }
}

const stubInstance = new StubPatientAdapter();

export function createStubPatientAdapter(): PatientSourceAdapter {
  return stubInstance;
}
