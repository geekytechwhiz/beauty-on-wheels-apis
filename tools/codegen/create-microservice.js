#!/usr/bin/env node
/* eslint-disable no-console */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVICE = process.argv[2];
const SPECS = process.argv[3];

const FLAGS = process.argv.slice(4);

const DRY_RUN = FLAGS.includes('--dry-run');
const SKIP_SERVERLESS = FLAGS.includes('--skip-serverless');
const SKIP_INDEX = FLAGS.includes('--skip-index');

if (!SERVICE || !SPECS) {
  console.error('');
  console.error('Usage:');
  console.error('');
  console.error(
    'node tools/codegen/create-microservice.js identity ./specs/identity.yaml',
  );
  console.error('');
  console.error('Options:');
  console.error('');
  console.error('--dry-run');
  console.error('--skip-serverless');
  console.error('--skip-index');
  console.error('');

  process.exit(1);
}
const OPENAPI = path.join('./tools/codegen/specs', SPECS);
const ROOT = findWorkspaceRoot(__dirname);

if (!ROOT) {
  console.error('');
  console.error('Unable to locate nx.json.');
  console.error('Make sure this script is inside an NX workspace.');
  console.error('');
  process.exit(1);
}

console.log(`Workspace : ${ROOT}`);
const openApiFile = path.join(ROOT, OPENAPI);
if (!fs.existsSync(openApiFile)) {
  console.error(`OpenAPI file not found : ${openApiFile}`);

  process.exit(1);
}

const start = Date.now();

console.log('');
console.log('===============================================');
console.log(' Microservice Generator');
console.log('===============================================');
console.log('');

console.log('Service :', SERVICE);
console.log('OpenAPI:', OPENAPI);
console.log('');

const steps = [
  {
    name: 'Create Service',
    script: '01-create-service.js',
    args: [SERVICE],
  },

  {
    name: 'Create Folder Structure',
    script: '02-create-folder-structure.js',
    args: [SERVICE],
  },

  {
    name: 'Parse OpenAPI',
    script: '03-parse-openapi.js',
    args: [SERVICE, OPENAPI],
  },

  {
    name: 'Generate Project',
    script: '04-generate-project.js',
    args: [SERVICE],
  },
];

if (!SKIP_SERVERLESS) {
  steps.push({
    name: 'Generate Serverless',

    script: '05-generate-serverless.js',

    args: [SERVICE],
  });
}

if (!SKIP_INDEX) {
  steps.push({
    name: 'Generate Index Files',

    script: '06-generate-index-files.js',

    args: [SERVICE],
  });
}

if (DRY_RUN) {
  console.log('');
  console.log('Dry Run');
  console.log('');

  steps.forEach((step, index) => {
    console.log(`${index + 1}. ${step.script} ${step.args.join(' ')}`);
  });

  console.log('');

  process.exit(0);
}

for (const step of steps) {
  runStep(step);
}

const duration = ((Date.now() - start) / 1000).toFixed(2);

console.log('');
console.log('===============================================');
console.log(' Generation Completed');
console.log('===============================================');
console.log('');

console.log(`Service : ${SERVICE}`);
console.log(`Time    : ${duration}s`);

console.log('');

/**
 * --------------------------------------------------------
 */

function runStep(step) {
  console.log('');

  console.log('-----------------------------------------');
  console.log(step.name);
  console.log('-----------------------------------------');

  console.log('');

  const command = process.platform === 'win32' ? 'node.exe' : 'node';

  const script = path.join(
    ROOT,

    'tools',

    'codegen',

    step.script,
  );

  const result = spawnSync(
    command,

    [script, ...step.args],

    {
      cwd: ROOT,

      stdio: 'inherit',
    },
  );

  if (result.error) {
    console.error(result.error);

    process.exit(1);
  }

  if (result.status !== 0) {
    console.error('');

    console.error(`${step.name} failed.`);

    console.error('');

    process.exit(result.status);
  }
}

function findWorkspaceRoot(startDir) {
  let current = startDir;

  while (true) {
    if (fs.existsSync(path.join(current, 'nx.json'))) {
      return current;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return null;
    }

    current = parent;
  }
}
