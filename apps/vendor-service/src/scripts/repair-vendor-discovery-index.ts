/* eslint-disable mvrx/no-direct-dynamodb, mvrx/no-process-env-outside-config, mvrx/enforce-platform-logger, no-console */
/**
 * Repairs only explicitly named PROFILE rows. Dry-run is the default.
 *
 * pnpm exec tsx apps/vendor-service/src/scripts/repair-vendor-discovery-index.ts \
 *   --region us-east-1 --table vendor-service-api-dev-vendor --vendor-id <id> [--vendor-id <id>]
 *
 * Add --apply only after reviewing dry-run output. The AWS SDK is pinned to
 *  carish-new so this command cannot silently use a developer's default profile.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { OperationalStatus, VendorStatus } from '../types/api-types';
import { VendorKeyBuilder } from '../utils/constants/vendor-key-builder';

type Profile = {
  PK: string;
  SK: string;
  vendorId: string;
  status: VendorStatus;
  operationalStatus: OperationalStatus;
  createdAt: string;
  GSI1PK?: string;
  GSI1SK?: string;
};

function args(argv: string[]) {
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const vendorIds = argv.flatMap((entry, index) => entry === '--vendor-id' ? [argv[index + 1]] : [])
    .filter((value): value is string => Boolean(value.trim()));
  return { region: value('--region'), table: value('--table'), vendorIds, apply: argv.includes('--apply') };
}

export function expectedDiscoveryKeys(profile: Pick<Profile, 'status' | 'operationalStatus' | 'createdAt' | 'vendorId'>) {
  return VendorKeyBuilder.vendorDiscoveryKeys(
    profile.status,
    profile.operationalStatus,
    profile.createdAt,
    profile.vendorId,
  );
}

export async function repairVendorDiscoveryIndexes(input: {
  table: string;
  vendorIds: string[];
  apply: boolean;
  document: Pick<DynamoDBDocumentClient, 'send'>;
}) {
  const results: Array<{ vendorId: string; action: 'unchanged' | 'repair' | 'missing' }> = [];
  for (const vendorId of input.vendorIds) {
    const response = await input.document.send(new GetCommand({
      TableName: input.table,
      Key: { PK: VendorKeyBuilder.vendorPk(vendorId), SK: VendorKeyBuilder.vendorSk() },
      ConsistentRead: true,
      ProjectionExpression: 'PK, SK, vendorId, #status, operationalStatus, createdAt, GSI1PK, GSI1SK',
      ExpressionAttributeNames: { '#status': 'status' },
    }));
    const profile = response.Item as Profile | undefined;
    if (!profile) {
      results.push({ vendorId, action: 'missing' });
      continue;
    }
    const keys = expectedDiscoveryKeys(profile);
    if (profile.GSI1PK === keys.GSI1PK && profile.GSI1SK === keys.GSI1SK) {
      results.push({ vendorId, action: 'unchanged' });
      continue;
    }
    if (input.apply) {
      await input.document.send(new UpdateCommand({
        TableName: input.table,
        Key: { PK: profile.PK, SK: profile.SK },
        UpdateExpression: 'SET GSI1PK = :gsi1pk, GSI1SK = :gsi1sk',
        ConditionExpression: '#status = :status AND operationalStatus = :operationalStatus AND createdAt = :createdAt AND vendorId = :vendorId',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':gsi1pk': keys.GSI1PK,
          ':gsi1sk': keys.GSI1SK,
          ':status': profile.status,
          ':operationalStatus': profile.operationalStatus,
          ':createdAt': profile.createdAt,
          ':vendorId': profile.vendorId,
        },
      }));
    }
    results.push({ vendorId, action: 'repair' });
  }
  return results;
}

async function main() {
  const input = args(process.argv.slice(2));
  if (!input.region || !input.table || input.vendorIds.length === 0) {
    throw new Error('--region, --table, and at least one --vendor-id are required');
  }
  process.env.AWS_PROFILE = ' carish-new';
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: input.region }));
  const results = await repairVendorDiscoveryIndexes({ ...input, document: client });
  console.log(JSON.stringify({ dryRun: !input.apply, results }));
}

if (require.main === module) {
  void main();
}
