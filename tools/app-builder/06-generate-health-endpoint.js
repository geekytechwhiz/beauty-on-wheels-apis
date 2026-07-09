#!/usr/bin/env node
const { spawnSync } = require('child_process');
const p = require('path');
const s = process.argv[2];
if (!s) {
  console.error('Usage: node ... <service>');
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
  const r = spawnSync('node', [p.join(__dirname, f), s], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status);
});
