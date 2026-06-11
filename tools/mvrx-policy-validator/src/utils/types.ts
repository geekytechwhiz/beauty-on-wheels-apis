export interface ValidationError {
  rule: string;
  file: string;
  message: string;
}

export type RuleValidator = (
  config: Record<string, any>,
  file: string,
) => ValidationError[];
