import type { PatientQuietWindow } from '@api-hub/task-core';

export interface QuietHoursProvider {
  getForPatient(input: { patientId: string; orgId: string }): Promise<PatientQuietWindow | null>;
}

/**
 * Phase 1 stub — always returns null (no adjustment).
 * Replace in phase 2 with a call to the patient profile / engagement service
 * to retrieve the patient's configured quiet-hours window and IANA timezone.
 */
export class EnvDefaultQuietHoursProvider implements QuietHoursProvider {
  async getForPatient(_input: { patientId: string; orgId: string }): Promise<PatientQuietWindow | null> {
    return null;
  }
}

let provider: QuietHoursProvider | undefined;

export function getQuietHoursProvider(): QuietHoursProvider {
  if (!provider) {
    provider = new EnvDefaultQuietHoursProvider();
  }
  return provider;
}

export function setQuietHoursProviderForTests(value: QuietHoursProvider | undefined): void {
  provider = value;
}
