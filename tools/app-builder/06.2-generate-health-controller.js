#!/usr/bin/env node

/**
 * ------------------------------------------------------------
 * Generate Controller
 *
 * Usage
 *
 * node tools/scripts/generate-controller.js booking Register
 *
 * Creates
 *
 * apps/booking-service/src/controllers/register.controller.ts
 *
 * ------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const SERVICE = process.argv[2];
const ENDPOINT = process.argv[3];

if (!SERVICE || !ENDPOINT) {
  console.error('');
  console.error('Usage:');
  console.error('node tools/scripts/generate-controller.js booking Register');
  console.error('');
  process.exit(1);
}

const ROOT = process.cwd();

const CONTROLLER_DIR = path.join(
  ROOT,
  'apps',
  `${SERVICE}-service`,
  'src',
  'controllers',
);

if (!fs.existsSync(CONTROLLER_DIR)) {
  fs.mkdirSync(CONTROLLER_DIR, {
    recursive: true,
  });
}

const FILE_NAME = `${toKebabCase(ENDPOINT)}.controller.ts`;

const FILE_PATH = path.join(CONTROLLER_DIR, FILE_NAME);

if (fs.existsSync(FILE_PATH)) {
  console.log('');

  console.log(`${FILE_NAME} already exists.`);

  process.exit(0);
}

fs.writeFileSync(FILE_PATH, generateController(), 'utf8');

console.log('');

console.log('✓ Controller Created');

console.log(FILE_PATH);

console.log('');

/**
 * ---------------------------------------
 */

function generateController() {
  return `import { LambdaRequest } from '@api-hub/utils';

import {
    get${ENDPOINT}Service
} from '../services/${toKebabCase(ENDPOINT)}.service';

export class ${ENDPOINT}Controller {

    constructor(

        private readonly service = get${ENDPOINT}Service()

    ) {}

    async handle(
        request: LambdaRequest
    ) {

        return this.service.execute(request.body);

    }

}

let controller: ${ENDPOINT}Controller;

export function get${ENDPOINT}Controller() {

    if (!controller) {

        controller = new ${ENDPOINT}Controller();

    }

    return controller;

}
`;
}

/**
 * ---------------------------------------
 */

function toKebabCase(value) {
  return value

    .replace(/([a-z])([A-Z])/g, '$1-$2')

    .replace(/\s+/g, '-')

    .toLowerCase();
}
