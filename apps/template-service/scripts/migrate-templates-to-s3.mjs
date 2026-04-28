#!/usr/bin/env node
/**
 * Migrates legacy template rows (inline config/rules/actions in DynamoDB) to S3 + schemaRef.
 *
 * Usage:
 *   TEMPLATE_TABLE=template-table-dev TEMPLATE_BUCKET=your-bucket REGION=us-east-1 node apps/template-service/scripts/migrate-templates-to-s3.mjs
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const TABLE = process.env.TEMPLATE_TABLE;
const BUCKET = process.env.TEMPLATE_BUCKET;
const REGION = process.env.REGION || process.env.AWS_REGION || 'us-east-1';

if (!TABLE || !BUCKET) {
  console.error('TEMPLATE_TABLE and TEMPLATE_BUCKET are required');
  process.exit(1);
}

function isLegacy(item) {
  if (item.config != null || item.rules != null || item.actions != null) return true;
  const ref = item.schemaRef;
  return typeof ref !== 'string' || ref.trim() === '';
}

function generateS3Key({ orgId, templateId, version, type }) {
  if (type === 'MASTER') {
    return `master/${templateId}/${version}/template.json`;
  }
  return `org/${orgId}/${templateId}/${version}/template.json`;
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const s3 = new S3Client({ region: REGION });

async function migrate() {
  let startKey;
  let migrated = 0;
  let skipped = 0;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        ExclusiveStartKey: startKey,
      }),
    );
    const items = res.Items ?? [];
    for (const item of items) {
      if (item.entityType !== 'TEMPLATE') {
        skipped++;
        continue;
      }
      if (!isLegacy(item)) {
        skipped++;
        continue;
      }
      const type = item.type || 'ORG';
      const orgId = item.orgId;
      const templateId = item.templateId;
      const version = item.version;
      const schemaRef = generateS3Key({ orgId, templateId, version, type });
      const doc = {
        config:
          typeof item.config === 'object' && item.config !== null && !Array.isArray(item.config)
            ? item.config
            : {},
        rules: 'rules' in item ? item.rules : {},
        actions: 'actions' in item ? item.actions : {},
      };
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: schemaRef,
          Body: JSON.stringify(doc),
          ContentType: 'application/json',
        }),
      );
      const newItem = {
        ...item,
        schemaRef,
        baseTemplateId: item.baseTemplateId || item.extendsTemplateId,
        baseVersion: item.baseVersion || item.extendsVersion,
        type,
      };
      delete newItem.config;
      delete newItem.rules;
      delete newItem.actions;
      delete newItem.extendsTemplateId;
      delete newItem.extendsVersion;
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: newItem,
        }),
      );
      migrated++;
    }
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  console.log(`Done. Migrated ${migrated} template rows (skipped ${skipped} non-legacy or non-template items).`);
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
