#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const generateSchemas = require('./generators/schema.generator');
const generateSwaggerTypes = require('./generators/swagger-types.generator');
const generateRepositories = require('./generators/repository.generator');
const generateServices = require('./generators/service.generator');
const generateControllers = require('./generators/controller.generator');
const generateHandlers = require('./generators/handler.generator');

const service = process.argv[2];

if (!service) {
  console.error('Usage: node tools/codegen/04-generate-project.js <service>');
  process.exit(1);
}

const metadataFile = path.join(process.cwd(), '.codegen', `${service}.json`);

if (!fs.existsSync(metadataFile)) {
  console.error(`Metadata file not found: ${metadataFile}`);
  process.exit(1);
}

const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
const projectRoot = path.join(process.cwd(), 'apps', `${service}-service`);

console.log('');
console.log('========================================');
console.log('Generating Project Source Code');
console.log('========================================');
console.log('');

// 1. Generate Schemas
generateSchemas(projectRoot, metadata);

// 1.5 Generate Swagger API Types
generateSwaggerTypes(projectRoot, metadata);

// 2. Generate Repositories
generateRepositories(projectRoot, metadata);

// 3. Generate Services
generateServices(projectRoot, metadata);

// 4. Generate Controllers
generateControllers(projectRoot, metadata);

// 5. Generate Handlers
generateHandlers(projectRoot, metadata);

// 6. Generate env config
const envConfigDir = path.join(projectRoot, 'src', 'configs');
fs.mkdirSync(envConfigDir, { recursive: true });
const envConfigPath = path.join(envConfigDir, 'env.config.ts');
const envConfigContent = `export const env = {
  SERVICE_NAME: process.env.SERVICE_NAME || '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || '',
  EVENT_BUS_NAME: process.env.EVENT_BUS_NAME || '',
};
`;
fs.writeFileSync(envConfigPath, envConfigContent, 'utf8');
console.log('✓ env.config.ts generated');

// 7. Overwrite tsconfig.app.json to avoid composite redirect issues
const tsconfigAppPath = path.join(projectRoot, 'tsconfig.app.json');
const tsconfigAppContent = {
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    outDir: "dist",
    types: ["node"],
    tsBuildInfoFile: "dist/tsconfig.app.tsbuildinfo",
    composite: false,
    declaration: false,
    declarationMap: false,
    emitDeclarationOnly: false
  },
  include: ["src/**/*.ts"],
  exclude: [
    "out-tsc",
    "dist",
    "jest.config.ts",
    "jest.config.cts",
    "src/**/*.spec.ts",
    "src/**/*.test.ts",
    "eslint.config.js",
    "eslint.config.cjs",
    "eslint.config.mjs"
  ]
};
fs.writeFileSync(tsconfigAppPath, JSON.stringify(tsconfigAppContent, null, 2), 'utf8');
console.log('✓ tsconfig.app.json updated');

console.log('');
console.log('========================================');
console.log('Project Source Code Generated');
console.log('========================================');
console.log('');
