export type UnknownCodeMode = 'pass' | 'reject';

export interface NormalizedCode {
  code: string;
  display?: string;
  known: boolean;
}

export interface TerminologyOptions {
  unknownCodeMode?: UnknownCodeMode;
  sourceSystem?: string;
}

export interface ReverseTerminologyOptions {
  targetSourceSystem?: string;
}

export class UnknownCodeError extends Error {
  readonly code = 'UNKNOWN_TERMINOLOGY_CODE';

  constructor(
    public readonly system: string,
    public readonly value: string,
  ) {
    super(`Unknown code "${value}" for system ${system}`);
    this.name = 'UnknownCodeError';
  }
}
