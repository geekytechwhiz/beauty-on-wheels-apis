export const CODE_SYSTEMS = {
  SNOMED: 'http://snomed.info/sct',
  LOINC: 'http://loinc.org',
  ICD10: 'http://hl7.org/fhir/sid/icd-10',
  ICD10CM: 'http://hl7.org/fhir/sid/icd-10-cm',
  ADMINISTRATIVE_GENDER: 'http://hl7.org/fhir/administrative-gender',
} as const;

export type SupportedCodeSystem =
  (typeof CODE_SYSTEMS)[keyof typeof CODE_SYSTEMS];

const STANDARD_CODE_SYSTEMS = new Set<string>([
  CODE_SYSTEMS.SNOMED,
  CODE_SYSTEMS.LOINC,
  CODE_SYSTEMS.ICD10,
  CODE_SYSTEMS.ICD10CM,
]);

export function isStandardCodeSystem(system: string): boolean {
  return STANDARD_CODE_SYSTEMS.has(system);
}

export function isValidCodeFormat(system: string, code: string): boolean {
  switch (system) {
    case CODE_SYSTEMS.LOINC:
      return /^\d{1,5}-\d$/.test(code);

    case CODE_SYSTEMS.SNOMED:
      return /^\d+$/.test(code);

    case CODE_SYSTEMS.ICD10:
    case CODE_SYSTEMS.ICD10CM:
      return /^[A-Z]\d{2}(?:\.\d{1,4})?$/i.test(code);

    case CODE_SYSTEMS.ADMINISTRATIVE_GENDER:
      return ['male', 'female', 'other', 'unknown'].includes(code.toLowerCase());

    default:
      return code.trim().length > 0;
  }
}
