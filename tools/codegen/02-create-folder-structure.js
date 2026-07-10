#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const SERVICE = process.argv[2];

if (!SERVICE) {
  console.error('');
  console.error('Usage:');
  console.error('');
  console.error('node tools/codegen/02-create-folder-structure.js identity');
  console.error('');
  process.exit(1);
}

const ROOT = process.cwd();

const APP_NAME = `${SERVICE}-service`;

const APP_PATH = path.join(ROOT, 'apps', APP_NAME);

if (!fs.existsSync(APP_PATH)) {
  console.error('');
  console.error(`${APP_NAME} does not exist.`);
  console.error('Run 01-create-service.js first.');
  console.error('');
  process.exit(1);
}

console.log('');
console.log('========================================');
console.log('Creating Folder Structure');
console.log('========================================');
console.log('');

const folders = [
  'src',

  'src/controllers',

  'src/handlers',

  'src/services',

  'src/repositories',

  'src/schemas',

  'src/utils',

  'src/utils/constants',

  'src/utils/types',

  'src/utils/helpers',

  'src/errors',

  'src/configs',
];

// Clean up default Nx assets folder if it exists
const assetsDir = path.join(APP_PATH, 'src/assets');
if (fs.existsSync(assetsDir)) {
  fs.rmSync(assetsDir, { recursive: true, force: true });
}

folders.forEach(createFolder);

createBaseFiles();

console.log('');
console.log('========================================');
console.log('Folder Structure Created');
console.log('========================================');
console.log('');

function createFolder(folder) {
  const dir = path.join(APP_PATH, folder);

  fs.mkdirSync(dir, {
    recursive: true,
  });

  console.log('✓', folder);
}

function createBaseFiles() {
  const files = [
    { name: 'src/index.ts', content: '' },

    { name: 'src/controllers/index.ts', content: '' },

    { name: 'src/handlers/index.ts', content: '' },

    { name: 'src/services/index.ts', content: '' },

    { name: 'src/repositories/index.ts', content: '' },

    { name: 'src/schemas/index.ts', content: '' },

    { name: 'src/utils/index.ts', content: 'export {};\n' },

    { name: 'src/utils/constants/index.ts', content: 'export {};\n' },

    { name: 'src/utils/types/index.ts', content: 'export {};\n' },

    { name: 'src/utils/helpers/index.ts', content: 'export {};\n' },

    { name: 'src/errors/index.ts', content: '' },
  ];

  files.forEach((file) => {
    const location = path.join(APP_PATH, file.name);

    if (!fs.existsSync(location)) {
      fs.writeFileSync(location, file.content);
    }
  });
}
