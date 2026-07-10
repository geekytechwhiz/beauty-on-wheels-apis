#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const service = process.argv[2];

if (!service) {
  console.error('Usage: node tools/codegen/06-generate-index-files.js <service>');
  process.exit(1);
}

const projectRoot = path.join(process.cwd(), 'apps', `${service}-service`);

console.log('');
console.log('========================================');
console.log('Generating Index & Export Files');
console.log('========================================');
console.log('');

const subdirs = ['handlers', 'controllers', 'services', 'repositories', 'schemas', 'configs'];
const populatedDirs = [];

subdirs.forEach((dirName) => {
  const dirPath = path.join(projectRoot, 'src', dirName);
  if (!fs.existsSync(dirPath)) return;

  const files = fs.readdirSync(dirPath);
  const exports = [];

  files.forEach((file) => {
    if (file.endsWith('.ts') && file !== 'index.ts') {
      const baseName = path.basename(file, '.ts');
      exports.push(`export * from "./${baseName}";`);
    }
  });

  if (exports.length > 0) {
    const indexContent = `// Auto-generated exports\n\n` + exports.join('\n') + '\n';
    fs.writeFileSync(path.join(dirPath, 'index.ts'), indexContent, 'utf8');
    console.log(`✓ Generated src/${dirName}/index.ts`);
    populatedDirs.push(dirName);
  } else {
    // Write empty or placeholder index if no files exist to prevent build warnings
    fs.writeFileSync(path.join(dirPath, 'index.ts'), '// No exports\nexport {};\n', 'utf8');
    console.log(`✓ Generated src/${dirName}/index.ts (empty/placeholder)`);
  }
});

// Generate main src/index.ts
const srcIndexExports = populatedDirs.map((dirName) => `export * from "./${dirName}";`);
const srcIndexContent = `// Auto-generated service entrypoint exports\n\n` + srcIndexExports.join('\n') + '\n';
fs.writeFileSync(path.join(projectRoot, 'src', 'index.ts'), srcIndexContent, 'utf8');
console.log('✓ Generated src/index.ts');

// Configure src/main.ts to import src/index.ts so Nx compiler/bundler evaluates all files
const mainPath = path.join(projectRoot, 'src', 'main.ts');
const mainContent = `// Entrypoint for Nx compilation
import './index';
`;
fs.writeFileSync(mainPath, mainContent, 'utf8');
console.log('✓ Configured src/main.ts');

console.log('');
console.log('========================================');
console.log('Index & Export Generation Completed');
console.log('========================================');
console.log('');
