export interface PatientCreationEvent {
    eventType: 'patient.creation.requested';
    eventId: string;
    timestamp: string;
    correlationId: string;
    data: {
      patient: {
        id: number;
        name: string;
        email?: string | null;
        phone?: string | null;
        gender: string;
        dob?: string | null;
        mrn?: string | null;
      };
      doctorId: number|string;
      organizationID: string; 
      provider: string;
      externalId: string;
    };
    metadata?: {
      retryCount?: number;
      source: 'sso-integration';
    };
  }
  