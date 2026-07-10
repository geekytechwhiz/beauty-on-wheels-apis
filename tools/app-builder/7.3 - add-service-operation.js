#!/usr/bin/env node

/**
 * ------------------------------------------------------------
 * Add Service Operation
 *
 * Usage:
 *
 * node tools/scripts/add-service-operation.js \
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
    'node tools/scripts/add-service-operation.js identity Authentication Register',
  );
  console.error('');

  process.exit(1);
}

const ROOT = process.cwd();

const FILE = path.join(
  ROOT,

  'apps',

  `${SERVICE}-service`,

  'src',

  'services',

  `${toKebabCase(RESOURCE)}.service.ts`,
);

if (!fs.existsSync(FILE)) {
  console.error('');

  console.error('Service not found.');

  console.error(FILE);

  process.exit(1);
}

let source = fs.readFileSync(FILE, 'utf8');

if (source.includes(`${lowerFirst(OPERATION)}(`)) {
  console.log('');

  console.log('Operation already exists.');

  process.exit(0);
}

const lastBrace = source.lastIndexOf('}');

const method = `

    async ${lowerFirst(OPERATION)}(
        request: any
    ) {

        /**
         * TODO
         * Implement ${OPERATION}
         */

        return {

            success: true,

            message: "${OPERATION} completed."

        };

    }

`;

source = source.substring(0, lastBrace) + method + source.substring(lastBrace);

fs.writeFileSync(
  FILE,

  source,

  'utf8',
);

console.log('');

console.log('✓ Added Service Method');

console.log(`${RESOURCE}.${OPERATION}`);

console.log('');

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function toKebabCase(value) {
  return value

    .replace(/([a-z])([A-Z])/g, '$1-$2')

    .replace(/\s+/g, '-')

    .toLowerCase();
}
