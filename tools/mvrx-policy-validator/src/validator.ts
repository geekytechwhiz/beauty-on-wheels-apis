/* eslint-disable mvrx/enforce-platform-logger */
import fs from 'fs';
import { globSync } from 'glob';
import YAML from 'yaml';

import { validateNoEnvVars } from './rules/no-env-vars';
import { validateHealthEndpoint } from './rules/require-health-endpoint';
import { validateAuthorizer } from './rules/require-authorizer';
import { validateVersioning } from './rules/disable-versioning'; 

import type { ValidationError } from './utils/types';

export function validateWorkspace(): void {
  const validators = [
    validateNoEnvVars,
    validateHealthEndpoint,
    validateAuthorizer,
    validateVersioning,
  ];

  const files = globSync('**/serverless.y?(a)ml', {
    ignore: [
      '**/node_modules/**',
      '**/.serverless/**',
      '**/dist/**',
      '**/.nx/**',
    ],
  });

  if (files.length === 0) {
    console.warn('⚠️ No serverless.yml files found in workspace');
    return;
  }

  const allErrors: ValidationError[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');

      const config = YAML.parse(content);

      for (const validator of validators) {
        const errors = validator(config, file);

        allErrors.push(...errors);
      }
    } catch (error) {
      allErrors.push({
        rule: 'yaml-parse-error',
        file,
        message: `Unable to parse serverless file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  if (allErrors.length > 0) {
    console.error('\n');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ MVRX Policy Validator Failed');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    allErrors.forEach((error) => {
      console.error(`\n[${error.rule}]`);
      console.error(`File: ${error.file}`);
      console.error(`Message: ${error.message}`);
    });

    console.error('\n');
    console.error(`Total Violations: ${allErrors.length}`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    process.exit(1);
  }
 
}
