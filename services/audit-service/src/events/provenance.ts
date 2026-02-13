/**
 * Provenance logger — record origin of FHIR resources (e.g. canonical source, transform).
 */
export interface ProvenancePayload {
  targetId: string;
  targetType: string;
  activity?: string;
  agent?: string;
  when?: string;
}

export async function logProvenance(_payload: ProvenancePayload): Promise<void> {
  // Placeholder: write to audit/provenance storage
}
