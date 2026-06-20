import { execSync } from 'child_process';
import { validateWorkspace } from './validator.js';

const files = execSync('git diff --cached --name-only', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter(
    (file) =>
      file.endsWith('serverless.yml') || file.endsWith('serverless.yaml'),
  );

if (files.length === 0) {
  process.exit(0);
}

validateWorkspace(files);
