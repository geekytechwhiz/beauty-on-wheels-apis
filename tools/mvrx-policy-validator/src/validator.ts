/* eslint-disable mvrx/enforce-platform-logger */
import fs from 'fs';
import { globSync } from 'glob';
import YAML from 'yaml';
import { execSync } from 'child_process';

import { validateNoEnvVars } from './rules/no-env-vars';
import { validateHealthEndpoint } from './rules/require-health-endpoint';
import { validateAuthorizer } from './rules/require-authorizer';
import { validateVersioning } from './rules/disable-versioning';

import type { ValidationError } from './utils/types';

function getChangedFiles(): Set<string> {
  const changed = new Set<string>();

  try {
    const statusOutput = execSync('git status --porcelain', {
      encoding: 'utf8',
    });
    statusOutput.split('\n').forEach((line) => {
      if (line.length > 3) {
        const filePath = line.substring(3).trim();
        changed.add(filePath);
      }
    });
  } catch (e) {
    throw new Error(`Failed to get changed files from git status: ${e}`);
  }

  const base = process.env.NX_BASE;
  const head = process.env.NX_HEAD;
  if (base && head) {
    try {
      const diffOutput = execSync(
        `git diff --name-only "${base}"..."${head}"`,
        {
          encoding: 'utf8',
        },
      );
      diffOutput.split('\n').forEach((line) => {
        const filePath = line.trim();
        if (filePath) {
          changed.add(filePath);
        }
      });
    } catch (e) {
      throw new Error(`Failed to get changed files from git status: ${e}`);
      // Ignore git diff errors
    }
  }

  return changed;
}

export function validateWorkspace(
  filePaths?: string[],
  onlyChanged = false,
): void {
  const validators = [
    validateNoEnvVars,
    validateHealthEndpoint,
    validateAuthorizer,
    validateVersioning,
  ];

  let files = filePaths;
  if (!files || files.length === 0) {
    files = globSync('**/serverless.y?(a)ml', {
      ignore: [
        '**/node_modules/**',
        '**/.serverless/**',
        '**/dist/**',
        '**/.nx/**',
      ],
    });
  } else {
    files = files
      .filter((file) => !file.startsWith('-'))
      .filter(
        (file) =>
          fs.existsSync(file) &&
          (file.endsWith('serverless.yml') || file.endsWith('serverless.yaml')),
      );
  }

  if (onlyChanged) {
    const changedFiles = getChangedFiles();
    files = files.filter((file) => changedFiles.has(file));
  }

  if (files.length === 0) {
    if (filePaths && filePaths.length > 0) {
      return;
    }
    console.warn('⚠️ No serverless.yml files found to validate');
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
