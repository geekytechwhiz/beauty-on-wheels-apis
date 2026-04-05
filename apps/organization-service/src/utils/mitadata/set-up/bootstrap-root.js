#!/usr/bin/env node

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');

// ===== CONFIG =====
const ENV = process.argv[2] || 'dev';
const REGION = process.env.AWS_REGION || 'us-east-1';

const ORG_TABLE = `organization-table-${ENV}`;
const USER_TABLE = `user-table-${ENV}`;

// ===== LOAD FILES =====
const rootOrg = require('./root-organization.json');
const rootUser = require('./root-user.json');
const basicDetail = require('./basic-detail.json');
const reverseMapping = require('./revers.json');
const orgVitals = require('./org-vitals.json');

// ===== AWS CLIENT =====
const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client);

// ===== HELPERS =====
async function putItem(table, item) {
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: item,
    })
  );
}

async function safePut(table, item) {
  try {
    await putItem(table, item);
    console.log(`✅ Inserted into ${table}:`, item.pk || item.id);
  } catch (err) {
    console.error(`❌ Failed for ${table}`, err.message);
  }
}

// ===== MAIN =====
async function run() {
  console.log('====================================');
  console.log(`🚀 Bootstrapping ENV: ${ENV}`);
  console.log('====================================');

  try {
    // ============================
    // 1. ROOT ORGANIZATION
    // ============================
    console.log('\n👉 Creating ROOT organization...');
    await safePut(ORG_TABLE, rootOrg);

    // ============================
    // 2. ROOT USER (3 records)
    // ============================
    console.log('\n👉 Creating ROOT user mappings...');

    await safePut(USER_TABLE, rootUser);        // main user
    await safePut(USER_TABLE, basicDetail);     // USER_BASIC_DETAILS
    await safePut(USER_TABLE, reverseMapping);  // reverse mapping

    // ============================
    // 3. ORG VITALS METADATA
    // ============================
    console.log('\n👉 Inserting org vitals metadata...');
    await safePut(ORG_TABLE, orgVitals);

    console.log('\n====================================');
    console.log('✅ Bootstrap completed successfully!');
    console.log('====================================');

  } catch (error) {
    console.error('\n❌ Bootstrap failed:', error);
    process.exit(1);
  }
}

run();