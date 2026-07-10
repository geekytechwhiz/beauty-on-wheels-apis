#!/usr/bin/env node
const { spawnSync } = require('child_process');
const p = require('path');
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node ... <service> <endpoint>');
  process.exit(1);
}
[
  '06.1-generate-health-handler.js',
  '06.2-generate-health-controller.js',
  '06.3-generate-health-service.js',
  '06.4-generate-health-validator.js',
  '06.5-generate-health-schema.js',
  '06.6-generate-health-function.js',
].forEach((f) => {
  const r = spawnSync('node', [p.join(__dirname, f), ...args], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status);
});
