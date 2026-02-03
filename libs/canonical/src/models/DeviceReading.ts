/**
 * Canonical DeviceReading model — pure business representation.
 * No FHIR imports or profile references.
 */
export interface DeviceReading {
  id: string;
  deviceId: string;
  userId: string;
  /** When the reading was taken */
  effectiveDateTime: string;
  /** Category of device (e.g. blood pressure, weight) */
  deviceCategory?: string;
  /** Raw or processed value payload */
  value?: unknown;
  /** Optional unit code (internal/canonical) */
  unit?: string;
  status?: 'active' | 'entered-in-error' | 'cancelled';
  createdAt?: string;
  updatedAt?: string;
}
