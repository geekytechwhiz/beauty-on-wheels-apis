#!/usr/bin/env node

/**
 * ------------------------------------------------------------
 * Copy Service Folder Structure
 *
 * Usage:
 *
 * node tools/scripts/03-copy-service-structure.js booking
 *
 * Source:
 * apps/identity-service
 *
 * Destination:
 * apps/booking-service
 *
 * Copies ONLY folders.
 * Does NOT copy business code.
 * Creates index.ts inside empty folders.
 * ------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const SERVICE = process.argv[2];

if (!SERVICE) {
  console.error('❌ Missing service name.');
  console.log('');
  console.log('Usage:');
  console.log('node tools/scripts/03-copy-service-structure.js booking');
  process.exit(1);
}

const ROOT = process.cwd();

const SOURCE = path.join(ROOT, 'apps', 'identity-service', 'src');

const TARGET = path.join(ROOT, 'apps', `${SERVICE}-service`, 'src');

if (!fs.existsSync(SOURCE)) {
  console.error('');
  console.error('❌ Identity Service not found.');
  console.error(SOURCE);
  process.exit(1);
}

if (!fs.existsSync(TARGET)) {
  console.error('');
  console.error('❌ Target service does not exist.');
  console.error(TARGET);
  process.exit(1);
}

console.log('');
console.log('======================================');
console.log(' Copying Service Structure');
console.log('======================================');
console.log('');

let folderCount = 0;

copyFolders(SOURCE, TARGET);

console.log('');
console.log(`✅ ${folderCount} folders created.`);
console.log('');

function copyFolders(source, target) {
  const entries = fs.readdirSync(source, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sourceDir = path.join(source, entry.name);

    const targetDir = path.join(target, entry.name);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, {
        recursive: true,
      });

      folderCount++;

      console.log('📁', path.relative(ROOT, targetDir));

      createIndexFile(targetDir);
    }

    copyFolders(sourceDir, targetDir);
  }
}

function createIndexFile(folder) {
  const indexFile = path.join(folder, 'index.ts');

  if (fs.existsSync(indexFile)) {
    return;
  }

  fs.writeFileSync(indexFile, '// Auto-generated\n');
}
