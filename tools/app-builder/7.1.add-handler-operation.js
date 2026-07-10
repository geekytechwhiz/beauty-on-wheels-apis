#!/usr/bin/env node

/**
 * ------------------------------------------------------------
 * Add Handler Operation
 *
 * Usage
 *
 * node tools/scripts/add-handler-operation.js \
 * identity \
 * Authentication \
 * Register
 *
 * ------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const SERVICE = process.argv[2];
const RESOURCE = process.argv[3];
const OPERATION = process.argv[4];

if (!SERVICE || !RESOURCE || !OPERATION) {
  console.error('');

  console.error('Usage:');

  console.error(
    'node tools/scripts/add-handler-operation.js identity Authentication Register',
  );

  process.exit(1);
}

const ROOT = process.cwd();

const HANDLER = path.join(
  ROOT,

  'apps',

  `${SERVICE}-service`,

  'src',

  'handlers',

  `${toKebabCase(RESOURCE)}.handler.ts`,
);

if (!fs.existsSync(HANDLER)) {
  console.error('');

  console.error('Handler not found');

  console.error(HANDLER);

  process.exit(1);
}

let source = fs.readFileSync(HANDLER, 'utf8');

/**
 * Already exists?
 */

if (source.includes(`handle${OPERATION}`)) {
  console.log('');

  console.log('Operation already exists.');

  process.exit(0);
}

/**
 * Add Import
 */

const validatorImport = `validate${OPERATION}Request`;

if (!source.includes(validatorImport)) {
  source = source.replace(
    /from '..\/validators\/.*?';/s,

    `from '../validators/${toKebabCase(RESOURCE)}.validator';

import {
    ${validatorImport}
} from '../validators/${toKebabCase(RESOURCE)}.validator';`,
  );
}

/**
 * Append Handler
 */

const handler = `

export const handle${OPERATION} = withApiHandler(
    {
        operation: '${SERVICE}.${lowerFirst(OPERATION)}',
        validator: validate${OPERATION}Request,
    },
    async (req: LambdaRequest) =>
        controller.handle${OPERATION}(req),
);

`;

source += handler;

fs.writeFileSync(HANDLER, source);

console.log('');

console.log('✓ Added');

console.log(`handle${OPERATION}`);

console.log('');

/**
 * Helpers
 */

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function toKebabCase(value) {
  return value

    .replace(/([a-z])([A-Z])/g, '$1-$2')

    .replace(/\s+/g, '-')

    .toLowerCase();
}
