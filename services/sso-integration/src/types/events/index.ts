export interface PatientCreationEvent {
  eventType: 'patient.creation.requested';
  eventId: string;
  timestamp: string;
  correlationId: string;

  data: {
    /**
     * Core patient details coming from the external HMS.
     * Only a subset may be present depending on the source system.
     */
    patient: {
      id: number | string;
      mrn?: string | null;

      // Identity
      name: string;
      namePrefix?: string | null;
      gender?: string | null;
      dob?: string | null;

      // Contact
      email?: string | null;
      phone?: string | null;
      phoneCode?: string | null;

      // Optional enriched data
      emergencyContact?: Record<string, unknown> | null;
      medicalHistory?: {
        allergies?: unknown[];
        chronicDiseases?: unknown[];
        symptoms?: unknown[];
      } | null;
    };
    externalIdentity: {
      subdomain: string;
      provider: string;
      externalUserId: string;
    };

    /**
     * Doctor identifier in our system (if already created) or external system.
     */
    doctorId?: number | string;

    /**
     * Target organization in our system.
     */
    organizationID: string;

    /**
     * External provider identifier (e.g. TruTech).
     */
    provider: string;

    /**
     * External user identifier from the HMS.
     * Used to construct externalIdentity.externalUserId.
     */
    externalId: string;
  };

  metadata?: {
    retryCount?: number;
    /**
     * Logical source of the event (e.g. "sso-integration").
     */
    source?: string;
    version?: string;
  };
}