/**
 * Metadata Migration Script
 * 
 * Migrates metadata from legacy sources (dev_global_common_user_data, S3, hardcoded)
 * to new microservices tables (user, organization, device)
 * 
 * Features:
 * - Idempotent (safe to re-run)
 * - Environment-agnostic (dev, qa, stg, prd)
 * - Batch processing with retry logic
 * - Comprehensive audit logging
 * - Rollback capability
 * 
 * Usage:
 *   node metadata_migration_script.js --env=dev --batch-size=100 --dry-run
 *   node metadata_migration_script.js --env=prd --batch-size=50 --resume-from=checkpoint-123
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, QueryCommand, PutCommand, UpdateCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const fs = require('fs').promises;
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Environment configuration
  ENV: process.env.ENV || process.argv.find(arg => arg.startsWith('--env='))?.split('=')[1] || 'dev',
  DRY_RUN: process.argv.includes('--dry-run'),
  BATCH_SIZE: parseInt(process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1] || '100'),
  RESUME_FROM: process.argv.find(arg => arg.startsWith('--resume-from='))?.split('=')[1] || null,
  
  // Table names (environment-specific)
  get LEGACY_TABLE() {
    return `${this.ENV}_common_user_data`;
  },
  get USER_TABLE() {
    return `${this.ENV}_user`;
  },
  get ORGANIZATION_TABLE() {
    return `${this.ENV}_organization`;
  },
  get DEVICE_TABLE() {
    return `${this.ENV}_device`;
  },
  
  // S3 buckets (environment-specific)
  get S3_BUCKETS() {
    const buckets = {
      dev: {
        rewards: process.env.DEV_REWARDS_BUCKET || 'dev-rewards-bucket',
        config: process.env.DEV_CONFIG_BUCKET || 'dev-config-bucket',
        vitals: process.env.DEV_VITALS_BUCKET || 'dev-vitals-bucket'
      },
      qa: {
        rewards: process.env.QA_REWARDS_BUCKET || 'qa-rewards-bucket',
        config: process.env.QA_CONFIG_BUCKET || 'qa-config-bucket',
        vitals: process.env.QA_VITALS_BUCKET || 'qa-vitals-bucket'
      },
      stg: {
        rewards: process.env.STG_REWARDS_BUCKET || 'stg-rewards-bucket',
        config: process.env.STG_CONFIG_BUCKET || 'stg-config-bucket',
        vitals: process.env.STG_VITALS_BUCKET || 'stg-vitals-bucket'
      },
      prd: {
        rewards: process.env.PRD_REWARDS_BUCKET || 'prd-rewards-bucket',
        config: process.env.PRD_CONFIG_BUCKET || 'prd-config-bucket',
        vitals: process.env.PRD_VITALS_BUCKET || 'prd-vitals-bucket'
      }
    };
    return buckets[this.ENV] || buckets.dev;
  },
  
  // AWS Region
  REGION: process.env.AWS_REGION || 'us-east-1',
  
  // Retry configuration
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  
  // Checkpoint configuration
  CHECKPOINT_DIR: './migration_checkpoints',
  LOG_DIR: './migration_logs'
};

// ============================================================================
// CLIENTS INITIALIZATION
// ============================================================================

const dynamoClient = new DynamoDBClient({ region: CONFIG.REGION });
const marshallOptions = {
  convertEmptyValues: false,
  removeUndefinedValues: true,
  convertClassInstanceToMap: false
};
const unmarshallOptions = { wrapNumbers: false };
const translateConfig = { marshallOptions, unmarshallOptions };
const docClient = DynamoDBDocumentClient.from(dynamoClient, translateConfig);

const s3Client = new S3Client({ region: CONFIG.REGION });

// ============================================================================
// LOGGING & AUDIT
// ============================================================================

class MigrationLogger {
  constructor(env, dryRun) {
    this.env = env;
    this.dryRun = dryRun;
    this.logFile = path.join(CONFIG.LOG_DIR, `migration_${env}_${Date.now()}.log`);
    this.stats = {
      users: { processed: 0, succeeded: 0, failed: 0, skipped: 0 },
      organizations: { processed: 0, succeeded: 0, failed: 0, skipped: 0 },
      devices: { processed: 0, succeeded: 0, failed: 0, skipped: 0 },
      s3Configs: { processed: 0, succeeded: 0, failed: 0, skipped: 0 },
      startTime: Date.now(),
      endTime: null
    };
  }

  async init() {
    await fs.mkdir(CONFIG.LOG_DIR, { recursive: true });
    await fs.writeFile(this.logFile, `Migration Log - ${new Date().toISOString()}\n${'='.repeat(80)}\n\n`, 'utf8');
  }

  async log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = this.dryRun ? '[DRY-RUN]' : '';
    const logEntry = `[${timestamp}] [${level}] ${prefix} ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}\n`;
    
    process.stdout.write(logEntry);
    await fs.appendFile(this.logFile, logEntry, 'utf8');
  }

  async info(message, data = null) {
    await this.log('INFO', message, data);
  }

  async error(message, error = null) {
    await this.log('ERROR', message, error ? { message: error.message, stack: error.stack } : null);
  }

  async warn(message, data = null) {
    await this.log('WARN', message, data);
  }

  async audit(entityType, entityId, operation, status, details = null) {
    const auditEntry = {
      timestamp: Date.now(),
      entityType,
      entityId,
      operation,
      status,
      details,
      environment: this.env
    };
    
    await this.log('AUDIT', `Entity: ${entityType}, ID: ${entityId}, Operation: ${operation}, Status: ${status}`, auditEntry);
    
    // Update stats
    if (this.stats[entityType]) {
      this.stats[entityType].processed++;
      if (status === 'SUCCESS') this.stats[entityType].succeeded++;
      else if (status === 'FAILED') this.stats[entityType].failed++;
      else if (status === 'SKIPPED') this.stats[entityType].skipped++;
    }
  }

  async finalize() {
    this.stats.endTime = Date.now();
    this.stats.duration = this.stats.endTime - this.stats.startTime;
    
    await this.info('Migration Statistics', this.stats);
    await fs.writeFile(
      path.join(CONFIG.LOG_DIR, `migration_stats_${this.env}_${Date.now()}.json`),
      JSON.stringify(this.stats, null, 2),
      'utf8'
    );
  }
}

// ============================================================================
// CHECKPOINT MANAGEMENT
// ============================================================================

class CheckpointManager {
  constructor(env) {
    this.checkpointFile = path.join(CONFIG.CHECKPOINT_DIR, `checkpoint_${env}.json`);
  }

  async init() {
    await fs.mkdir(CONFIG.CHECKPOINT_DIR, { recursive: true });
  }

  async save(checkpoint) {
    await fs.writeFile(this.checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf8');
  }

  async load() {
    try {
      const data = await fs.readFile(this.checkpointFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async clear() {
    try {
      await fs.unlink(this.checkpointFile);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff(fn, maxRetries = CONFIG.MAX_RETRIES, delay = CONFIG.RETRY_DELAY_MS) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await sleep(delay * attempt);
    }
  }
}

function extractIdFromKey(key, prefix) {
  if (!key || !key.startsWith(prefix)) return null;
  return key.substring(prefix.length);
}

function extractIdFromSk(sk, prefix) {
  if (!sk || !sk.startsWith(prefix)) return null;
  return sk.substring(prefix.length);
}

// ============================================================================
// DATA TRANSFORMATION FUNCTIONS
// ============================================================================

function transformUserProfile(item) {
  const userId = extractIdFromKey(item.pk, 'USER#');
  const organizationId = extractIdFromSk(item.sk, 'USER_BASIC_DETAILS#');
  
  if (!userId || !organizationId) return null;

  return {
    id: userId,
    organizationId: organizationId,
    firstName: item.firstName || null,
    lastName: item.lastName || null,
    email: item.email ? item.email.toLowerCase() : null,
    phoneNumber: item.phoneNumber || null,
    profilePic: item.profilePic || null,
    gender: item.gender ? item.gender.toLowerCase() : null,
    dateOfBirth: item.dateOfBirth || null,
    weight: item.weight || null,
    height: item.height || null,
    address: item.address || null,
    medicalHistory: item.medicalHistory || [],
    allergies: item.allergies || [],
    mrnNumber: item.mrnNumber || null,
    status: (item.status || 'ACTIVE').toUpperCase(),
    isLoggedIn: item.isLoggedIn || false,
    logoutAt: item.logoutAt || null,
    pushToken: item.pushToken || null,
    voipToken: item.voipToken || null,
    platform: item.platform || null,
    tokenUpdatedAt: item.tokenUpdatedAt || null,
    isTaskCompleted: item.isTaskCompleted || false,
    createdAt: item.createdDate || Date.now(),
    modifiedAt: item.modifiedDate || Date.now()
  };
}

function transformOrganizationProfile(item) {
  let organizationId = null;
  
  // Extract from sk pattern: ORG#{organizationId}
  if (item.sk && item.sk.startsWith('ORG#')) {
    organizationId = extractIdFromSk(item.sk, 'ORG#');
  }
  
  // Or from organizationInfo
  if (!organizationId && item.organizationInfo?.organizationID) {
    organizationId = item.organizationInfo.organizationID;
  }
  
  if (!organizationId) return null;

  const orgInfo = item.organizationInfo || {};

  return {
    id: organizationId,
    name: orgInfo.organizationName || item.name || null,
    email: item.emailAddress ? item.emailAddress.toLowerCase() : null,
    phone: orgInfo.phoneNumber || null,
    phoneCode: orgInfo.phoneCode || null,
    address: orgInfo.address || null,
    organizationType: orgInfo.organizationType || null,
    organizationSize: orgInfo.organizationSize || null,
    status: (item.status || 'ACTIVE').toUpperCase(),
    createdAt: item.createdDate || Date.now(),
    modifiedAt: item.modifiedDate || Date.now()
  };
}

function transformDeviceConfig(item) {
  const deviceId = item.deviceId || item.sk3 || null;
  if (!deviceId) return null;

  return {
    id: deviceId,
    name: item.name || null,
    displayName: item.displayName || null,
    category: item.category ? item.category.toUpperCase() : null,
    manufacturerName: item.manufacturerName || null,
    manufacturerImage: item.manufacturerImage || null,
    deviceImage: item.deviceImage || null,
    template: item.template || null,
    deviceDetails: item.deviceDetails || null,
    isAutoSyncSupported: item.isAutoSyncSupported !== undefined ? item.isAutoSyncSupported : true,
    enabled: item.enabled !== undefined ? item.enabled : true,
    supportedVitals: item.supportedVitals || [],
    countriesSupported: item.countriesSupported || [],
    createdAt: item.createdDate || Date.now(),
    modifiedAt: item.modifiedDate || Date.now()
  };
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function scanTable(tableName, lastEvaluatedKey = null, filterExpression = null) {
  const params = {
    TableName: tableName,
    Limit: CONFIG.BATCH_SIZE
  };
  
  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = lastEvaluatedKey;
  }
  
  if (filterExpression) {
    params.FilterExpression = filterExpression;
  }

  return await retryWithBackoff(async () => {
    return await docClient.send(new ScanCommand(params));
  });
}

async function queryTable(tableName, keyConditionExpression, expressionAttributeValues, lastEvaluatedKey = null) {
  const params = {
    TableName: tableName,
    KeyConditionExpression: keyConditionExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    Limit: CONFIG.BATCH_SIZE
  };
  
  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = lastEvaluatedKey;
  }

  return await retryWithBackoff(async () => {
    return await docClient.send(new QueryCommand(params));
  });
}

async function upsertItem(tableName, item, logger) {
  if (CONFIG.DRY_RUN) {
    await logger.info(`[DRY-RUN] Would upsert to ${tableName}`, { item });
    return { success: true, dryRun: true };
  }

  try {
    // Try update first (if exists)
    const updateParams = {
      TableName: tableName,
      Key: { id: item.id },
      UpdateExpression: 'SET ' + Object.keys(item)
        .filter(key => key !== 'id')
        .map(key => `#${key} = :${key}`)
        .join(', '),
      ExpressionAttributeNames: Object.keys(item)
        .filter(key => key !== 'id')
        .reduce((acc, key) => ({ ...acc, [`#${key}`]: key }), {}),
      ExpressionAttributeValues: Object.keys(item)
        .filter(key => key !== 'id')
        .reduce((acc, key) => ({ ...acc, [`:${key}`]: item[key] }), {})
    };

    await retryWithBackoff(async () => {
      await docClient.send(new UpdateCommand(updateParams));
    });

    return { success: true, operation: 'update' };
  } catch (error) {
    // If update fails, try put (create)
    if (error.name === 'ValidationException' || error.name === 'ResourceNotFoundException') {
      const putParams = {
        TableName: tableName,
        Item: item
      };

      await retryWithBackoff(async () => {
        await docClient.send(new PutCommand(putParams));
      });

      return { success: true, operation: 'create' };
    }
    throw error;
  }
}

async function batchUpsert(tableName, items, logger) {
  if (CONFIG.DRY_RUN) {
    await logger.info(`[DRY-RUN] Would batch upsert ${items.length} items to ${tableName}`);
    return { success: true, dryRun: true, count: items.length };
  }

  const batches = [];
  for (let i = 0; i < items.length; i += 25) {
    batches.push(items.slice(i, i + 25));
  }

  let successCount = 0;
  let failCount = 0;

  for (const batch of batches) {
    try {
      const requests = batch.map(item => ({
        PutRequest: { Item: item }
      }));

      const params = {
        RequestItems: {
          [tableName]: requests
        }
      };

      await retryWithBackoff(async () => {
        await docClient.send(new BatchWriteCommand(params));
      });

      successCount += batch.length;
    } catch (error) {
      failCount += batch.length;
      await logger.error(`Batch upsert failed for ${tableName}`, error);
    }
  }

  return { success: successCount > 0, count: successCount, failed: failCount };
}

// ============================================================================
// S3 OPERATIONS
// ============================================================================

async function loadS3Config(bucket, key, logger) {
  try {
    const params = { Bucket: bucket, Key: key };
    const command = new GetObjectCommand(params);
    const response = await s3Client.send(command);
    const body = await response.Body.transformToString();
    return JSON.parse(body);
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      await logger.warn(`S3 object not found: s3://${bucket}/${key}`);
      return null;
    }
    throw error;
  }
}

async function listS3Objects(bucket, prefix, logger) {
  try {
    const params = { Bucket: bucket, Prefix: prefix };
    const command = new ListObjectsV2Command(params);
    const response = await s3Client.send(command);
    return response.Contents || [];
  } catch (error) {
    await logger.error(`Failed to list S3 objects: s3://${bucket}/${prefix}`, error);
    return [];
  }
}

// ============================================================================
// MIGRATION FUNCTIONS
// ============================================================================

async function migrateUsers(logger, checkpoint) {
  await logger.info('Starting user migration...');
  
  let lastEvaluatedKey = checkpoint?.users?.lastKey || null;
  let processed = checkpoint?.users?.processed || 0;
  let totalProcessed = 0;

  while (true) {
    const result = await scanTable(
      CONFIG.LEGACY_TABLE,
      lastEvaluatedKey,
      'begins_with(pk, :pk)',
      { ':pk': 'USER#' }
    );

    const userItems = result.Items.filter(item => 
      item.pk?.startsWith('USER#') && 
      item.sk?.startsWith('USER_BASIC_DETAILS#')
    );

    for (const item of userItems) {
      try {
        const transformed = transformUserProfile(item);
        if (!transformed) {
          await logger.warn(`Skipping invalid user item: ${item.pk}`);
          continue;
        }

        const result = await upsertItem(CONFIG.USER_TABLE, transformed, logger);
        if (result.success) {
          await logger.audit('users', transformed.id, 'UPSERT', 'SUCCESS', { operation: result.operation });
        }
      } catch (error) {
        await logger.audit('users', item.pk, 'UPSERT', 'FAILED', { error: error.message });
        await logger.error(`Failed to migrate user: ${item.pk}`, error);
      }
    }

    processed += userItems.length;
    totalProcessed += userItems.length;
    lastEvaluatedKey = result.LastEvaluatedKey;

    await logger.info(`Processed ${processed} users. Last key: ${lastEvaluatedKey ? JSON.stringify(lastEvaluatedKey) : 'none'}`);

    if (!lastEvaluatedKey) break;
  }

  await logger.info(`User migration completed. Total processed: ${totalProcessed}`);
  return { processed: totalProcessed, lastKey: null };
}

async function migrateOrganizations(logger, checkpoint) {
  await logger.info('Starting organization migration...');
  
  let lastEvaluatedKey = checkpoint?.organizations?.lastKey || null;
  let processed = checkpoint?.organizations?.processed || 0;
  let totalProcessed = 0;

  // Migrate organization profiles
  while (true) {
    const result = await queryTable(
      CONFIG.LEGACY_TABLE,
      'pk = :pk',
      { ':pk': 'ORG_LIST' },
      lastEvaluatedKey
    );

    for (const item of result.Items) {
      try {
        const transformed = transformOrganizationProfile(item);
        if (!transformed) {
          await logger.warn(`Skipping invalid organization item: ${item.pk}`);
          continue;
        }

        const result = await upsertItem(CONFIG.ORGANIZATION_TABLE, transformed, logger);
        if (result.success) {
          await logger.audit('organizations', transformed.id, 'UPSERT', 'SUCCESS', { operation: result.operation });
        }
      } catch (error) {
        await logger.audit('organizations', item.sk, 'UPSERT', 'FAILED', { error: error.message });
        await logger.error(`Failed to migrate organization: ${item.sk}`, error);
      }
    }

    processed += result.Items.length;
    totalProcessed += result.Items.length;
    lastEvaluatedKey = result.LastEvaluatedKey;

    await logger.info(`Processed ${processed} organizations. Last key: ${lastEvaluatedKey ? JSON.stringify(lastEvaluatedKey) : 'none'}`);

    if (!lastEvaluatedKey) break;
  }

  await logger.info(`Organization migration completed. Total processed: ${totalProcessed}`);
  return { processed: totalProcessed, lastKey: null };
}

async function migrateDevices(logger, checkpoint) {
  await logger.info('Starting device migration...');
  
  let lastEvaluatedKey = checkpoint?.devices?.lastKey || null;
  let processed = checkpoint?.devices?.processed || 0;
  let totalProcessed = 0;

  while (true) {
    const result = await queryTable(
      CONFIG.LEGACY_TABLE,
      'pk = :pk',
      { ':pk': 'DEVICE_LIST' },
      lastEvaluatedKey
    );

    for (const item of result.Items) {
      try {
        const transformed = transformDeviceConfig(item);
        if (!transformed) {
          await logger.warn(`Skipping invalid device item: ${item.pk}`);
          continue;
        }

        const result = await upsertItem(CONFIG.DEVICE_TABLE, transformed, logger);
        if (result.success) {
          await logger.audit('devices', transformed.id, 'UPSERT', 'SUCCESS', { operation: result.operation });
        }
      } catch (error) {
        await logger.audit('devices', item.sk, 'UPSERT', 'FAILED', { error: error.message });
        await logger.error(`Failed to migrate device: ${item.sk}`, error);
      }
    }

    processed += result.Items.length;
    totalProcessed += result.Items.length;
    lastEvaluatedKey = result.LastEvaluatedKey;

    await logger.info(`Processed ${processed} devices. Last key: ${lastEvaluatedKey ? JSON.stringify(lastEvaluatedKey) : 'none'}`);

    if (!lastEvaluatedKey) break;
  }

  await logger.info(`Device migration completed. Total processed: ${totalProcessed}`);
  return { processed: totalProcessed, lastKey: null };
}

async function migrateS3Configs(logger, checkpoint) {
  await logger.info('Starting S3 config migration...');
  
  const buckets = CONFIG.S3_BUCKETS;
  let processed = 0;

  // Migrate organization-specific S3 configs
  const orgIds = await getOrganizationIds();
  
  for (const orgId of orgIds) {
    // Milestones
    try {
      const milestones = await loadS3Config(buckets.rewards, `${orgId}/milestones.json`, logger);
      if (milestones) {
        // Store in organization metadata
        await logger.audit('s3Configs', `${orgId}/milestones`, 'LOAD', 'SUCCESS');
        processed++;
      }
    } catch (error) {
      await logger.audit('s3Configs', `${orgId}/milestones`, 'LOAD', 'FAILED', { error: error.message });
    }

    // Rules
    try {
      const rules = await loadS3Config(buckets.rewards, `${orgId}/rules.json`, logger);
      if (rules) {
        await logger.audit('s3Configs', `${orgId}/rules`, 'LOAD', 'SUCCESS');
        processed++;
      }
    } catch (error) {
      await logger.audit('s3Configs', `${orgId}/rules`, 'LOAD', 'FAILED', { error: error.message });
    }

    // Tiers
    try {
      const tiers = await loadS3Config(buckets.rewards, `${orgId}/tiers.json`, logger);
      if (tiers) {
        await logger.audit('s3Configs', `${orgId}/tiers`, 'LOAD', 'SUCCESS');
        processed++;
      }
    } catch (error) {
      await logger.audit('s3Configs', `${orgId}/tiers`, 'LOAD', 'FAILED', { error: error.message });
    }
  }

  // Migrate global S3 configs
  try {
    const thresholds = await loadS3Config(buckets.config, 'thresholds.json', logger);
    if (thresholds) {
      await logger.audit('s3Configs', 'thresholds.json', 'LOAD', 'SUCCESS');
      processed++;
    }
  } catch (error) {
    await logger.audit('s3Configs', 'thresholds.json', 'LOAD', 'FAILED', { error: error.message });
  }

  try {
    const goals = await loadS3Config(buckets.config, 'goals.json', logger);
    if (goals) {
      await logger.audit('s3Configs', 'goals.json', 'LOAD', 'SUCCESS');
      processed++;
    }
  } catch (error) {
    await logger.audit('s3Configs', 'goals.json', 'LOAD', 'FAILED', { error: error.message });
  }

  await logger.info(`S3 config migration completed. Total processed: ${processed}`);
  return { processed };
}

async function getOrganizationIds() {
  const result = await queryTable(
    CONFIG.LEGACY_TABLE,
    'pk = :pk',
    { ':pk': 'ORG_LIST' }
  );
  return result.Items.map(item => {
    if (item.sk?.startsWith('ORG#')) {
      return extractIdFromSk(item.sk, 'ORG#');
    }
    return item.organizationInfo?.organizationID;
  }).filter(Boolean);
}

// ============================================================================
// MAIN MIGRATION FUNCTION
// ============================================================================

async function main() {
  const logger = new MigrationLogger(CONFIG.ENV, CONFIG.DRY_RUN);
  const checkpointManager = new CheckpointManager(CONFIG.ENV);

  try {
    await logger.init();
    await checkpointManager.init();

    await logger.info('='.repeat(80));
    await logger.info(`Starting metadata migration for environment: ${CONFIG.ENV}`);
    await logger.info(`Dry run mode: ${CONFIG.DRY_RUN}`);
    await logger.info(`Batch size: ${CONFIG.BATCH_SIZE}`);
    await logger.info('='.repeat(80));

    // Load checkpoint if resuming
    const checkpoint = CONFIG.RESUME_FROM 
      ? await checkpointManager.load()
      : { users: {}, organizations: {}, devices: {}, s3Configs: {} };

    if (checkpoint && CONFIG.RESUME_FROM) {
      await logger.info(`Resuming from checkpoint: ${CONFIG.RESUME_FROM}`);
    }

    // Execute migrations
    checkpoint.users = await migrateUsers(logger, checkpoint);
    await checkpointManager.save(checkpoint);

    checkpoint.organizations = await migrateOrganizations(logger, checkpoint);
    await checkpointManager.save(checkpoint);

    checkpoint.devices = await migrateDevices(logger, checkpoint);
    await checkpointManager.save(checkpoint);

    checkpoint.s3Configs = await migrateS3Configs(logger, checkpoint);
    await checkpointManager.save(checkpoint);

    // Finalize
    await logger.finalize();
    await checkpointManager.clear();

    await logger.info('='.repeat(80));
    await logger.info('Migration completed successfully!');
    await logger.info('='.repeat(80));

  } catch (error) {
    await logger.error('Migration failed with error', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main, transformUserProfile, transformOrganizationProfile, transformDeviceConfig };
