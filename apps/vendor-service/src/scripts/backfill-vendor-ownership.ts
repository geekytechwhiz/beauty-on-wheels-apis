/**
 * Dry-run by default. Does not match owners by phone number.
 *
 * pnpm exec ts-node --esm apps/vendor-service/src/scripts/backfill-vendor-ownership.ts \
 *   --table vendor-service-dev-vendor --out ownership-report.json
 *
 * Apply only after reviewing the report. Optional verified mappings:
 * { "mappings": [{ "vendorId": "...", "canonicalUserId": "u-...", "verified": true }] }
 *
 * pnpm exec ts-node --esm apps/vendor-service/src/scripts/backfill-vendor-ownership.ts \
 *   --table vendor-service-dev-vendor --mapping ownership-mapping.json --apply
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { writeFileSync } from 'node:fs';

import {
  buildOwnershipRepairWrite,
  isCanonicalUserId,
  planOwnershipRepair,
  type OwnershipRepairPlan,
  type VendorOwnershipSnapshot,
  type VerifiedOwnershipMapping,
} from '../domain/ownership-backfill';

interface VendorItem {
  PK?: string;
  SK?: string;
  vendorId?: string;
  ownerUserId?: string;
  userId?: string;
  phoneNumber?: string;
  GSI1PK?: string;
  entityType?: string;
}

export interface OwnershipBackfillReport {
  dryRun: boolean;
  scannedItems: number;
  plans: OwnershipRepairPlan[];
  applied: string[];
  failed: Array<{ vendorId: string; message: string }>;
}

export interface OwnershipBackfillOptions {
  dryRun: boolean;
  verifiedMappings?: VerifiedOwnershipMapping[];
  now?: string;
}

export function snapshotsFromItems(items: VendorItem[]): {
  snapshots: VendorOwnershipSnapshot[];
  locks: Map<string, string>;
} {
  const profiles = new Map<string, VendorItem>();
  const owners = new Map<string, VendorItem>();
  const locks = new Map<string, string>();

  for (const item of items) {
    if (item.entityType === 'Vendor' && item.SK === 'PROFILE' && item.vendorId) {
      profiles.set(item.vendorId, item);
    } else if (
      item.entityType === 'VendorOwner' &&
      item.SK === 'OWNER' &&
      item.vendorId
    ) {
      owners.set(item.vendorId, item);
    } else if (
      item.entityType === 'VendorOwnership' &&
      item.SK === 'VENDOR' &&
      item.ownerUserId &&
      item.vendorId
    ) {
      locks.set(item.ownerUserId, item.vendorId);
    }
  }

  const vendorIds = new Set([...profiles.keys(), ...owners.keys()]);
  const snapshots = [...vendorIds].map((vendorId) => {
    const profile = profiles.get(vendorId);
    const owner = owners.get(vendorId);
    return {
      vendorId,
      profileOwnerUserId: profile?.ownerUserId,
      ownerItemUserId: owner?.userId,
      ownerGsi1Pk: owner?.GSI1PK,
      hasOwnerItem: Boolean(owner),
      unverifiedPhoneNumber: profile?.phoneNumber,
    };
  });

  return { snapshots, locks };
}

export function planOwnershipBackfill(
  items: VendorItem[],
  options: OwnershipBackfillOptions,
): OwnershipRepairPlan[] {
  const { snapshots, locks } = snapshotsFromItems(items);
  const canonicalCounts = new Map<string, number>();
  for (const snapshot of snapshots) {
    const ownerId = snapshot.profileOwnerUserId?.trim();
    if (!ownerId) {
      continue;
    }
    canonicalCounts.set(ownerId, (canonicalCounts.get(ownerId) ?? 0) + 1);
  }

  return snapshots.map((snapshot) => {
    const ownerId = snapshot.profileOwnerUserId?.trim();
    const mapping = (options.verifiedMappings ?? []).find(
      (entry) => entry.vendorId === snapshot.vendorId && entry.verified,
    );
    const lockOwnerId =
      mapping && isCanonicalUserId(mapping.canonicalUserId)
        ? mapping.canonicalUserId.trim()
        : ownerId;
    return planOwnershipRepair(snapshot, {
      verifiedMappings: options.verifiedMappings,
      ownershipLockVendorId: lockOwnerId ? locks.get(lockOwnerId) : undefined,
      duplicateCanonicalOwner: Boolean(
        ownerId &&
          isCanonicalUserId(ownerId) &&
          (canonicalCounts.get(ownerId) ?? 0) > 1,
      ),
    });
  });
}

export async function applyOwnershipRepair(input: {
  tableName: string;
  items: VendorItem[];
  plan: OwnershipRepairPlan;
  now: string;
  transact: (items: Record<string, unknown>[]) => Promise<void>;
}): Promise<void> {
  const snapshot = snapshotsFromItems(input.items).snapshots.find(
    (item) => item.vendorId === input.plan.vendorId,
  );
  if (!snapshot) {
    throw new Error(`Vendor ${input.plan.vendorId} was not in the scanned set`);
  }
  const write = buildOwnershipRepairWrite(snapshot, input.plan, input.now);
  if (!write) {
    return;
  }

  const transactItems: Record<string, unknown>[] = [
    {
      Put: {
        TableName: input.tableName,
        Item: write.ownershipItem,
        ConditionExpression:
          'attribute_not_exists(PK) OR vendorId = :vendorId',
        ExpressionAttributeValues: {
          ':vendorId': snapshot.vendorId,
        },
      },
    },
  ];

  if (write.plan.writeOwnerItem) {
    if (snapshot.hasOwnerItem) {
      transactItems.push({
        Update: {
          TableName: input.tableName,
          Key: write.ownerKey,
          UpdateExpression:
            'SET userId = :userId, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk, updatedAt = :updatedAt',
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
          ExpressionAttributeValues: {
            ':userId': write.plan.canonicalUserId,
            ':gsi1pk': write.gsi1pk,
            ':gsi1sk': write.gsi1sk,
            ':updatedAt': input.now,
          },
        },
      });
    } else {
      transactItems.push({
        Put: {
          TableName: input.tableName,
          Item: {
            ...write.ownerKey,
            vendorId: snapshot.vendorId,
            userId: write.plan.canonicalUserId,
            createdAt: input.now,
            updatedAt: input.now,
            GSI1PK: write.gsi1pk,
            GSI1SK: write.gsi1sk,
            entityType: 'VendorOwner',
          },
          ConditionExpression:
            'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      });
    }
  }

  if (write.plan.updateProfileOwnerUserId) {
    const expectedOwnerUserId = write.plan.expectedProfileOwnerUserId;
    transactItems.push({
      Update: {
        TableName: input.tableName,
        Key: write.profileKey,
        UpdateExpression: 'SET ownerUserId = :userId, updatedAt = :updatedAt',
        ConditionExpression: expectedOwnerUserId
          ? 'attribute_exists(PK) AND ownerUserId = :expectedOwnerUserId'
          : 'attribute_exists(PK) AND attribute_not_exists(ownerUserId)',
        ExpressionAttributeValues: {
          ':userId': write.plan.canonicalUserId,
          ':updatedAt': input.now,
          ...(expectedOwnerUserId
            ? { ':expectedOwnerUserId': expectedOwnerUserId }
            : {}),
        },
      },
    });
  }

  await input.transact(transactItems);
}

function parseArgs(argv: string[]) {
  const tableIndex = argv.indexOf('--table');
  const mappingIndex = argv.indexOf('--mapping');
  const outIndex = argv.indexOf('--out');
  return {
    tableName: tableIndex >= 0 ? argv[tableIndex + 1] : process.env.DYNAMODB_TABLE_NAME,
    mappingPath: mappingIndex >= 0 ? argv[mappingIndex + 1] : undefined,
    outPath: outIndex >= 0 ? argv[outIndex + 1] : undefined,
    apply: argv.includes('--apply'),
  };
}

async function scanVendorItems(
  document: DynamoDBDocumentClient,
  tableName: string,
): Promise<VendorItem[]> {
  const items: VendorItem[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await document.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: startKey,
        FilterExpression: 'entityType IN (:vendor, :owner, :lock)',
        ExpressionAttributeValues: {
          ':vendor': 'Vendor',
          ':owner': 'VendorOwner',
          ':lock': 'VendorOwnership',
        },
      }),
    );
    items.push(...((page.Items ?? []) as VendorItem[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items;
}

export async function runOwnershipBackfill(input: {
  items: VendorItem[];
  tableName: string;
  options: OwnershipBackfillOptions;
  transact?: (items: Record<string, unknown>[]) => Promise<void>;
}): Promise<OwnershipBackfillReport> {
  const plans = planOwnershipBackfill(input.items, input.options);
  const report: OwnershipBackfillReport = {
    dryRun: input.options.dryRun,
    scannedItems: input.items.length,
    plans,
    applied: [],
    failed: [],
  };
  if (input.options.dryRun || !input.transact) {
    return report;
  }

  const now = input.options.now ?? new Date().toISOString();
  for (const plan of plans) {
    if (
      plan.action === 'unchanged' ||
      plan.action === 'manual_reconciliation'
    ) {
      continue;
    }
    try {
      await applyOwnershipRepair({
        tableName: input.tableName,
        items: input.items,
        plan,
        now,
        transact: input.transact,
      });
      report.applied.push(plan.vendorId);
    } catch (err) {
      report.failed.push({
        vendorId: plan.vendorId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return report;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.tableName) {
    throw new Error('--table or DYNAMODB_TABLE_NAME is required');
  }
  const mappings = args.mappingPath
    ? (
        JSON.parse(
          await import('node:fs').then((fs) =>
            fs.readFileSync(args.mappingPath!, 'utf8'),
          ),
        ) as { mappings?: VerifiedOwnershipMapping[] }
      ).mappings ?? []
    : [];

  const document = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const items = await scanVendorItems(document, args.tableName);
  const report = await runOwnershipBackfill({
    items,
    tableName: args.tableName,
    options: {
      dryRun: !args.apply,
      verifiedMappings: mappings,
    },
    transact: async (transactItems) => {
      await document.send(
        new TransactWriteCommand({
          TransactItems: transactItems as never,
        }),
      );
    },
  });

  const body = JSON.stringify(report, null, 2);
  if (args.outPath) {
    writeFileSync(args.outPath, body);
  }
  process.stdout.write(`${body}\n`);
  if (report.failed.length > 0) {
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1]?.includes('backfill-vendor-ownership');
if (invokedDirectly) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
