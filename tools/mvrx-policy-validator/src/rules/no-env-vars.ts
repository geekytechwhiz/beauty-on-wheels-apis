import { ValidationError } from '../utils/types';

export function validateNoEnvVars(
  config: Record<string, any>,
  file: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  const content = JSON.stringify(config);

  const matches = content.match(/\${env:[^}]+}/g) || [];

  for (const match of matches) {
    errors.push({
      rule: 'no-env-vars',
      file,
      message: `Environment variables are not allowed. Found '${match}'. Use \${param:*} instead.`,
    });
  }

  return errors;
}
