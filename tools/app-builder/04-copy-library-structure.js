#!/usr/bin/env node

/**
 * ------------------------------------------------------------
 * Generate serverless.yml
 *
 * Usage
 *
 * node tools/scripts/04-generate-serverless.js booking
 *
 * ------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const SERVICE = process.argv[2];

if (!SERVICE) {
  console.error('Usage:');
  console.error('node tools/scripts/04-generate-serverless.js booking');
  process.exit(1);
}

const ROOT = process.cwd();

const SOURCE = path.join(ROOT, 'apps', 'identity-service', 'serverless.yml');

const TARGET = path.join(ROOT, 'apps', `${SERVICE}-service`, 'serverless.yml');

if (!fs.existsSync(SOURCE)) {
  console.error('Identity serverless.yml not found.');
  process.exit(1);
}

let yaml = fs.readFileSync(SOURCE, 'utf8');

console.log('');
console.log('Generating serverless.yml...');
console.log('');

/**
 * ---------------------------------------
 * Replace service names
 * ---------------------------------------
 */

yaml = yaml.replace(/identity-service/g, `${SERVICE}-service`);

yaml = yaml.replace(/Identity/g, capitalize(SERVICE));

yaml = yaml.replace(/identity/g, SERVICE);

yaml = yaml.replace(/IDENTITY/g, SERVICE.toUpperCase());

/**
 * ---------------------------------------
 * Replace table names
 * ---------------------------------------
 */

yaml = yaml.replace(/identity-table/g, `${SERVICE}-table`);

yaml = yaml.replace(/identity-events-topic/g, `${SERVICE}-events-topic`);

yaml = yaml.replace(/identity-service-bus/g, `${SERVICE}-service-bus`);

yaml = yaml.replace(/IDENTITY_TABLE/g, `${SERVICE.toUpperCase()}_TABLE`);

yaml = yaml.replace(
  /IDENTITY_EVENTS_TOPIC/g,
  `${SERVICE.toUpperCase()}_EVENTS_TOPIC`,
);

yaml = yaml.replace(
  /IDENTITY_EVENT_BUS/g,
  `${SERVICE.toUpperCase()}_EVENT_BUS`,
);

/**
 * ---------------------------------------
 * Remove Functions
 * ---------------------------------------
 */

yaml = replaceFunctions(yaml);

/**
 * ---------------------------------------
 * Write File
 * ---------------------------------------
 */

fs.writeFileSync(TARGET, yaml);

console.log('serverless.yml generated');
console.log('');

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function replaceFunctions(content) {
  const health = `
functions:

  health:

    handler: src/handlers/health.handler.handleHealth

    events:

      - http:

          path: /health

          method: get

          cors: true

`;

  const regex =
    /functions:[\s\S]*?(?=\nresources:|\ncustom:|\nplugins:|\npackage:|\nprovider:|$)/;

  return content.replace(regex, health);
}
