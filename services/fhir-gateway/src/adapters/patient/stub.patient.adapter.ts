/**
 * Stub patient adapter for local/dev when no backend is configured.
 */
import type { Patient } from '@api-hub/canonical';
import type { GetPatientOptions, PatientSourceAdapter } from './patient-source.types';

export class StubPatientAdapter implements PatientSourceAdapter {
  async getPatient(id: string, _options?: GetPatientOptions) {
    const canonical: Patient = {
      id,
      active: true,
      givenName: 'Stub',
      familyName: 'Patient',
    };
    return { canonical, raw: {} };
  }
}
