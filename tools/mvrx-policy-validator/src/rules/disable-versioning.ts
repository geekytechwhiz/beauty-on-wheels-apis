import { ValidationError } from '../utils/types';

export function validateVersioning(
  config: Record<string, any>,
  file: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  const versionFunctions = config?.provider?.versionFunctions;

  if (versionFunctions !== false) {
    errors.push({
      rule: 'disable-versioning',
      file,
      message: 'provider.versionFunctions must be explicitly set to false.',
    });
  }

  return errors;
}
