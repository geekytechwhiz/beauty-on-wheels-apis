#!/usr/bin/env node
/**
 * Insert org-vitals metadata into the organization DynamoDB table.
 *
 * Exports insertOrgVitalsMetadata() for use from Lambdas.
 * CLI usage: node mitadata/insert-org-vitals.js --profile ci-user --env dev
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const fs = require('fs').promises;
const path = require('path');

const ORG_META = 'ORG_META';
const SUPPORTED_VITALS = 'SUPPORTED_VITALS';

/**
 * Build the DynamoDB item for SUPPORTED_VITALS metadata.
 * @param {{ attributes: unknown[] }} payload - Must have pk=ORG_META, sk=SUPPORTED_VITALS and attributes array
 * @returns {Record<string, unknown>} Item to put
 */
function buildOrgVitalsItem(payload) {
  const now = Date.now();
  return {
    pk: payload.pk ?? ORG_META,
    sk: payload.sk ?? SUPPORTED_VITALS,
    attributes: payload.attributes ?? [],
    createdDate: payload.createdDate ?? now,
    modifiedDate: now,
  };
}

/**
 * Insert or overwrite SUPPORTED_VITALS metadata in the organization table.
 * Call this from a Lambda (e.g. after deploy or from a setup handler).
 *
 * @param {{
 *   tableName: string;
 *   payload?: { pk?: string; sk?: string; attributes: unknown[]; createdDate?: number };
 *   attributes?: unknown[];
 *   docClient?: import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient;
 *   region?: string;
 * }} options
 * @returns {Promise<{ success: true }>}
 *
 * @example
 * // From Lambda (use env table and default payload)
 * const { insertOrgVitalsMetadata } = require('./insert-org-vitals');
 * await insertOrgVitalsMetadata({
 *   tableName: process.env.ORGANIZATION_TABLE,
 *   attributes: [ { bloodPressure: { code: 'bloodPressure', ... } }, ... ],
 * });
 *
 * @example
 * // With full payload (e.g. from JSON)
 * await insertOrgVitalsMetadata({
 *   tableName: process.env.ORGANIZATION_TABLE,
 *   payload: { pk: 'ORG_META', sk: 'SUPPORTED_VITALS', attributes: [...] },
 * });
 *
 * @example
 * // With existing docClient (e.g. from @api-hub/utils)
 * const { ddbDocClient } = require('@api-hub/utils');
 * await insertOrgVitalsMetadata({
 *   tableName: process.env.ORGANIZATION_TABLE,
 *   payload: myPayload,
 *   docClient: ddbDocClient,
 * });
 */
async function insertOrgVitalsMetadata(options) {
  const { tableName, payload: rawPayload, attributes, docClient: providedClient, region } = options || {};

  if (!tableName || typeof tableName !== 'string') {
    throw new Error('insertOrgVitalsMetadata: tableName is required');
  }

  const payload = rawPayload ?? (attributes ? { attributes } : null);
  if (!payload || !Array.isArray(payload.attributes)) {
    throw new Error('insertOrgVitalsMetadata: payload.attributes or options.attributes (array) is required');
  }

  const item = buildOrgVitalsItem({
    pk: ORG_META,
    sk: SUPPORTED_VITALS,
    attributes: payload.attributes,
    createdDate: payload.createdDate,
    modifiedDate: undefined,
  });

  const client = providedClient ?? (() => {
    const base = new DynamoDBClient({ region: region || process.env.AWS_REGION || 'us-east-1' });
    return DynamoDBDocumentClient.from(base, {
      marshallOptions: { convertEmptyValues: false, removeUndefinedValues: true },
    });
  })();

  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
    })
  );

  return { success: true };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const DEFAULT_PROFILE = 'ci-user';
const DEFAULT_ENV = 'dev';
const DEFAULT_TABLE_PREFIX = 'organization-table';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    profile: process.env.AWS_PROFILE || DEFAULT_PROFILE,
    table: null,
    env: DEFAULT_ENV,
    dryRun: false,
    dataPath: path.join(__dirname, 'data', 'org-vitals.json'),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) out.profile = args[++i];
    else if (args[i] === '--table' && args[i + 1]) out.table = args[++i];
    else if (args[i] === '--env' && args[i + 1]) out.env = args[++i];
    else if (args[i] === '--dry-run') out.dryRun = true;
    else if (args[i] === '--data' && args[i + 1]) out.dataPath = args[++i];
  }
  if (!out.table) out.table = `${DEFAULT_TABLE_PREFIX}-${out.env}`;
  return out;
}

async function main() {
  const opts = parseArgs();
  if (opts.profile) process.env.AWS_PROFILE = opts.profile;

  const payload = JSON.parse(await fs.readFile(path.resolve(opts.dataPath), 'utf8'));
  if (payload.pk !== ORG_META || payload.sk !== SUPPORTED_VITALS) {
    console.error('Invalid payload: expected pk=ORG_META and sk=SUPPORTED_VITALS');
    process.exit(1);
  }

  console.log('AWS profile:', opts.profile);
  console.log('Table:', opts.table);
  console.log('Item keys: pk=%s, sk=%s', payload.pk, payload.sk);
  console.log('Attributes count:', Array.isArray(payload.attributes) ? payload.attributes.length : 0);

  if (opts.dryRun) {
    console.log('\n[DRY-RUN] Would put item');
    return;
  }

  await insertOrgVitalsMetadata({
    tableName: opts.table,
    payload,
    region: process.env.AWS_REGION || 'us-east-1',
  });

  console.log('Inserted SUPPORTED_VITALS metadata into', opts.table);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { insertOrgVitalsMetadata, buildOrgVitalsItem };
