x/**
 * Canonical ObservationValue model — pure business representation.
 * No FHIR imports or profile references.
 */
export interface ObservationValue {
  id: string;
  /** Subject (e.g. patient) identifier */
  subjectId: string;
  /** When the observation was made */
  effectiveDateTime: string;
  /** Logical code for the observation (e.g. blood pressure, weight) */
  code?: string;
  /** Human-readable concept */
  display?: string;
  /** System for the code (canonical/internal) */
  system?: string;
  /** Numeric value if applicable */
  valueQuantity?: {
    value: number;
    unit?: string;
    system?: string;
    code?: string;
  };
  /** Coded value if applicable */
  valueCodeableConcept?: {
    code?: string;
    display?: string;
    system?: string;
  };
  status?: 'registered' | 'preliminary' | 'final' | 'amended' | 'cancelled';
  /** Optional link to device reading */
  deviceReadingId?: string;
  createdAt?: string;
  updatedAt?: string;
}
