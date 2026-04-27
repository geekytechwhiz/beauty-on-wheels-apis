export interface FhirAdapter<TCanonical, TFhir> {
  /**
   * FHIR resourceType this adapter produces, e.g. "Patient".
   */
  readonly resourceType: string;

  /**
   * Convert a canonical model instance into a FHIR resource.
   */
  toFHIR(canonical: TCanonical, config?: any): TFhir;
}

