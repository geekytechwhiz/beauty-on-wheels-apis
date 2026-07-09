#!/usr/bin/env node

/**
 * ------------------------------------------------------------
 * Create NX Core Library
 *
 * Usage:
 *
 * node tools/scripts/02-create-library.js booking
 *
 * Creates:
 *
 * libs/booking-core
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
  console.log('node tools/scripts/02-create-library.js booking');
  process.exit(1);
}

const LIB_NAME = `${SERVICE_NAME}-core`;

const ROOT = process.cwd();

const LIB_PATH = path.join(ROOT, 'libs', LIB_NAME);

if (fs.existsSync(LIB_PATH)) {
  console.error('');
  console.error(`❌ ${LIB_NAME} already exists.`);
  process.exit(1);
}

console.log('');
console.log('========================================');
console.log(' Creating NX Library');
console.log('========================================');
console.log('');

console.log(`Library : ${LIB_NAME}`);
console.log('');

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const result = spawnSync(
  command,
  [
    'nx',
    'g',
    '@nx/js:library',

    LIB_NAME,

    `--directory=../../libs/${LIB_NAME}`,

    '--bundler=tsc',

    '--unitTestRunner=jest',

    '--linter=eslint',

    '--strict=true',

    '--projectNameAndRootFormat=as-provided',

    '--importPath=@api-hub/' + LIB_NAME,
  ],
  {
    stdio: 'inherit',
    shell: false,
  },
);

if (result.status !== 0) {
  console.error('');
  console.error('❌ Failed to create library.');
  process.exit(result.status);
}

console.log('');
console.log('✅ Library created successfully.');
console.log('');
console.log(LIB_PATH);
console.log('');
