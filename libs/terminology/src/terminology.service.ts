import { createDefaultAliasRegistry, CodeAliasRegistry } from './aliases';
import { mapCode, reverseMapCode } from './code-mapping';
import {
  CODE_SYSTEMS,
  isStandardCodeSystem,
  isValidCodeFormat,
} from './code-systems';
import {
  NormalizedCode,
  ReverseTerminologyOptions,
  TerminologyOptions,
  UnknownCodeError,
  UnknownCodeMode,
} from './types';

export interface TerminologyService {
  normalizeCode(
    system: string,
    value: string,
    options?: TerminologyOptions,
  ): NormalizedCode;

  reverseNormalizeCode(
    system: string,
    value: string,
    options?: ReverseTerminologyOptions,
  ): string;
}

export interface SharedTerminologyServiceOptions {
  unknownCodeMode?: UnknownCodeMode;
  aliases?: CodeAliasRegistry;
}

export class SharedTerminologyService implements TerminologyService {
  private readonly unknownCodeMode: UnknownCodeMode;

  constructor(
    private readonly aliases: CodeAliasRegistry = createDefaultAliasRegistry(),
    options: SharedTerminologyServiceOptions = {},
  ) {
    this.unknownCodeMode = options.unknownCodeMode ?? 'pass';
  }

  normalizeCode(
    system: string,
    value: string,
    options: TerminologyOptions = {},
  ): NormalizedCode {
    const unknownCodeMode = options.unknownCodeMode ?? this.unknownCodeMode;
    const input = String(value);

    const alias = this.aliases.resolve(system, input);
    if (alias) {
      return {
        code: alias.code,
        display: alias.display,
        known: true,
      };
    }

    if (options.sourceSystem) {
      const mapped = mapCode(input, options.sourceSystem, system);
      if (mapped) {
        return {
          code: mapped.code,
          display: mapped.display,
          known: true,
        };
      }
    }

    if (isStandardCodeSystem(system) && isValidCodeFormat(system, input)) {
      return {
        code: input,
        known: true,
      };
    }

    if (unknownCodeMode === 'reject') {
      throw new UnknownCodeError(system, input);
    }

    return {
      code: input,
      known: false,
    };
  }

  reverseNormalizeCode(
    system: string,
    value: string,
    options: ReverseTerminologyOptions = {},
  ): string {
    const input = String(value);

    const aliasValue = this.aliases.reverse(system, input);
    if (aliasValue) {
      return aliasValue;
    }

    if (options.targetSourceSystem) {
      const mapped = reverseMapCode(
        input,
        system,
        options.targetSourceSystem,
      );
      if (mapped) {
        return mapped;
      }
    }

    return input;
  }
}

export const defaultTerminologyService = new SharedTerminologyService();

export { CODE_SYSTEMS };
