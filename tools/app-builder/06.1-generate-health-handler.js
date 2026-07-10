#!/usr/bin/env node

/**
 * ------------------------------------------------------------
 * Generate Handler
 *
 * Usage:
 *
 * node tools/scripts/generate-handler.js booking Health
 *
 * node tools/scripts/generate-handler.js booking Register
 *
 * ------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const SERVICE = process.argv[2];
const ENDPOINT = process.argv[3];
console.log('args', process.argv);
if (!SERVICE || !ENDPOINT) {
  console.error('');
  console.error('Usage:');
  console.error('node tools/scripts/generate-handler.js booking Health');
  console.error('');
  process.exit(1);
}

const ROOT = process.cwd();

const SERVICE_PATH = path.join(ROOT, '../../apps', `${SERVICE}-service`);
console.log('SERVICE_PATH ', SERVICE_PATH);
if (!fs.existsSync(SERVICE_PATH)) {
  console.error(`${SERVICE}-service does not exist.`);
  process.exit(1);
}

const HANDLER_DIR = path.join(SERVICE_PATH, 'src', 'handlers');

fs.mkdirSync(HANDLER_DIR, {
  recursive: true,
});

const FILE_NAME = `${toKebabCase(ENDPOINT)}.handler.ts`;

const FILE_PATH = path.join(HANDLER_DIR, FILE_NAME);

if (fs.existsSync(FILE_PATH)) {
  console.log('Handler already exists.');

  process.exit(0);
}

const content = generateHandler();

fs.writeFileSync(FILE_PATH, content, 'utf8');

console.log('✓', FILE_NAME);

function generateHandler() {
  const endpointCamel = lowerFirst(ENDPOINT);

  return `import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { get${ENDPOINT}Controller } from '../controllers/${toKebabCase(ENDPOINT)}.controller';

import {
    validate${ENDPOINT}Request
} from '../validators/${toKebabCase(ENDPOINT)}.validator';

const controller = get${ENDPOINT}Controller();

export const handle${ENDPOINT} = withApiHandler(
    {
        operation: '${SERVICE}.${endpointCamel}',
        validator: validate${ENDPOINT}Request,
    },
    async (req: LambdaRequest) => {

        return controller.handle(req);

    }
);
`;
}

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function toKebabCase(value) {
  return value

    .replace(/([a-z])([A-Z])/g, '$1-$2')

    .replace(/\s+/g, '-')

    .toLowerCase();
}
