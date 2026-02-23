#!/usr/bin/env node
/**
 * Insert root-level device list (pk=DEVICE_LIST, sk=CATEGORY#...#...) into the device DynamoDB table.
 * Single source of truth: data/device-list.json. Table name: DEVICE_TABLE (from serverless) > --table > device-table-<env>.
 *
 * Usage:
 *   node insert-device-list.js --env dev [--data data/device-list.json] [--dry-run]
 *   node insert-device-list.js --env nvstg
 *   DEVICE_TABLE=device-table-nvstg node insert-device-list.js --env nvstg
 *
 * In CodeBuild, buildspec sets DEVICE_TABLE from serverless print. CodeBuild role needs dynamodb:PutItem/BatchWriteItem on the table (see CODEBUILD-IAM.md).
 */

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const scriptDir = __dirname;
const defaultDataPath = path.join(scriptDir, 'data', 'device-list.json');
const TABLE_PREFIX = 'device-table';

function parseArgs() {
  const args = process.argv.slice(2);
  let env = process.env.STAGE || process.env.SERVERLESS_STAGE || null;
  let tableName = process.env.DEVICE_TABLE || null;
  let dataPath = defaultDataPath;
  let dryRun = false;
  let region = process.env.AWS_REGION || 'us-east-1';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && args[i + 1]) env = args[++i];
    else if (args[i] === '--table' && args[i + 1]) tableName = args[++i];
    else if (args[i] === '--data' && args[i + 1]) dataPath = args[++i];
    else if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--region' && args[i + 1]) region = args[++i];
  }
  if (!tableName && env) tableName = `${TABLE_PREFIX}-${env}`;
  return { env, tableName, dataPath, dryRun, region };
}

async function main() {
  const { env, tableName, dataPath, dryRun, region } = parseArgs();
  if (!tableName) {
    console.error('Set --env (dev|stg|prd) or DEVICE_TABLE');
    process.exit(1);
  }

  const resolvedPath = path.resolve(scriptDir, dataPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error('Data file not found:', resolvedPath);
    console.error('Generate it first: node csv-to-json.js --input /path/to/results-7.csv --output data/device-list.json');
    process.exit(1);
  } 
  const items = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  if (!Array.isArray(items) || items.length === 0) {
    console.error('No items in', resolvedPath);
    process.exit(1);
  }

  console.log('Table:', tableName);
  console.log('Items:', items.length);
  console.log('Dry run:', dryRun);

  if (dryRun) {
    console.log('[DRY-RUN] Would put', items.length, 'items');
    return;
  }

  const client = new DynamoDBClient({ region });
  const docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { convertEmptyValues: false, removeUndefinedValues: true },
  });

  const BATCH_SIZE = 25;
  let written = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const request = {
      RequestItems: {
        [tableName]: batch.map((item) => ({ PutRequest: { Item: item } })),
      },
    };
    await docClient.send(new BatchWriteCommand(request));
    written += batch.length;
    console.log('Wrote', written, '/', items.length);
  }
  console.log('Done. Inserted', written, 'device list items into', tableName);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
