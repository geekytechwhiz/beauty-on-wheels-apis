/**
 * Terminology / code mapping — internal to FHIR code system mapping.
 * No external terminology server dependency required at runtime.
 * Extend MAPPING or registerMapping() for your internal/partner codes.
 */

export interface MappedCoding {
  system: string;
  code: string;
  display?: string;
}

/**
 * Internal code (system + code) -> target system coding.
 * Add entries for your internal/partner systems (e.g. lab codes -> LOINC).
 */
const MAPPING: Record<string, MappedCoding> = {
  // Example: internal lab code -> LOINC (extend as needed)
  // 'http://internal.example.com|cbc': { system: 'http://loinc.org', code: '58410-2', display: 'CBC' },
};

/**
 * Register a mapping from (internalSystem + '|' + internalCode) to a target coding.
 * Call at startup or from config to add mappings without code changes.
 */
export function registerMapping(
  internalSystem: string,
  internalCode: string,
  target: MappedCoding
): void {
  const key = `${internalSystem}|${internalCode}`;
  MAPPING[key] = target;
}

/**
 * Map an internal code to a target code system (e.g. LOINC, SNOMED).
 * @param internalCode - Internal or partner code
 * @param system - Internal/system identifier (e.g. internal system URL)
 * @param targetSystem - Target FHIR code system URL (e.g. 'http://loinc.org')
 * @returns Mapped coding for the target system, or undefined if no mapping
 */
export function mapCode(
  internalCode: string,
  system: string,
  targetSystem: string
): MappedCoding | undefined {
  const key = `${system}|${internalCode}`;
  const mapped = MAPPING[key];
  if (mapped && mapped.system === targetSystem) {
    return mapped;
  }
  // Linear fallback: find first mapping for this internal code whose system matches target
  for (const k of Object.keys(MAPPING)) {
    if (!k.startsWith(`${system}|`)) continue;
    const v = MAPPING[k];
    if (v.system === targetSystem) return v;
  }
  return undefined;
}
