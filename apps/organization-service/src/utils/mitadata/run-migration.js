#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

const ENV = process.argv[2] || 'dev';

async function run() {
  console.log('====================================');
  console.log(`🚀 Starting Migration for ENV: ${ENV}`);
  console.log('====================================');

  try {
    // STEP 1: ROOT ORG + USER
    console.log('\n👉 Step 1: Creating ROOT org & user...');
    execSync(`bash setup.sh ${ENV}`, { stdio: 'inherit' });

    // STEP 2: ORG METADATA (SUPPORTED_VITALS)
    console.log('\n👉 Step 2: Inserting org metadata...');
    execSync(
      `node insert-org-vitals.js --env ${ENV} --data ./org-vitals.json`,
      { stdio: 'inherit' }
    );

    // STEP 3: MIGRATION (optional but recommended)
    console.log('\n👉 Step 3: Running full migration...');
    execSync(
      `node script.js --env=${ENV} --batch-size=50`,
      { stdio: 'inherit' }
    );

    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

run();