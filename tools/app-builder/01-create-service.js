#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * ------------------------------------------------------------
 * Create NX Service
 *
 * Usage:
 *
 * node tools/scripts/01-create-service.js identity
 *
 * Creates
 *
 * apps/identity-service
 *
 * ------------------------------------------------------------
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVICE_NAME = process.argv[2];

if (!SERVICE_NAME) {
  console.error('❌ Missing service name.');
  console.log('');
  console.log('Usage:');
  console.log('node tools/scripts/01-create-service.js booking');
  process.exit(1);
}

const APP_NAME = `${SERVICE_NAME}-service`;

const ROOT = process.cwd();

const APP_PATH = path.join(ROOT, 'apps', APP_NAME);

if (fs.existsSync(APP_PATH)) {
  console.error('');
  console.error(`❌ ${APP_NAME} already exists.`);
  process.exit(1);
}

console.log('');
console.log('========================================');
console.log(' Creating NX Application');
console.log('========================================');
console.log('');

console.log(`Service : ${APP_NAME}`);
console.log('');

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const result = spawnSync(
  command,
  [
    'nx',
    'g',
    '@nx/node:application',

    APP_NAME,

    `--directory=../../apps/${APP_NAME}`,

    '--framework=none',

    '--bundler=esbuild',

    '--unitTestRunner=jest',

    '--linter=eslint',

    '--e2eTestRunner=none',

    '--strict=true',

    '--projectNameAndRootFormat=as-provided',
  ],
  {
    stdio: 'inherit',
    shell: false,
  },
);

if (result.status !== 0) {
  console.error('');
  console.error('❌ Failed to create application.');
  process.exit(result.status);
}

console.log('');
console.log('✅ Application created successfully.');
console.log('');
console.log(APP_PATH);
console.log('');
