import {
  defaultTerminologyService as sharedDefaultTerminologyService,
  SharedTerminologyService,
  type TerminologyService as SharedTerminologyServiceInterface,
} from '@api-hub/terminology';

export type {
  NormalizedCode,
  ReverseTerminologyOptions,
  TerminologyOptions,
  UnknownCodeMode,
} from '@api-hub/terminology';

export {
  CODE_SYSTEMS,
  SharedTerminologyService,
  UnknownCodeError,
  createDefaultAliasRegistry,
  mapCode,
  registerMapping,
  reverseMapCode,
} from '@api-hub/terminology';

export interface TerminologyService {
  normalizeCode(
    system: string,
    value: string,
  ): {
    code: string;
    display?: string;
  };

  reverseNormalizeCode(
    system: string,
    value: string,
  ): string;
}

/**
 * FHIR adapter over the shared terminology service.
 * Defaults to pass-through for unknown codes to preserve existing Patient output.
 */
export class FhirTerminologyService implements TerminologyService {
  constructor(
    private readonly shared: SharedTerminologyServiceInterface = sharedDefaultTerminologyService,
  ) {}

  normalizeCode(system: string, value: string) {
    const result = this.shared.normalizeCode(system, value);
    return {
      code: result.code,
      display: result.display,
    };
  }

  reverseNormalizeCode(system: string, value: string): string {
    return this.shared.reverseNormalizeCode(system, value);
  }
}

export const defaultTerminologyService = new FhirTerminologyService();

export function createTerminologyService(
  options: ConstructorParameters<typeof SharedTerminologyService>[1] = {},
): TerminologyService {
  return new FhirTerminologyService(new SharedTerminologyService(undefined, options));
}
