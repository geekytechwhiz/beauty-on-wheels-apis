/**
 * Identify capacity proposals/commitments missing offeringId and optionally apply
 * verified mappings. Dry-run by default — never invents offeringId from serviceScopeCode.
 *
 * Report only:
 *   pnpm exec ts-node --esm apps/vendor-service/src/scripts/backfill-capacity-scope-offering.ts \
 *     --table vendor-service-dev-vendor --out capacity-scope-report.json
 *
 * Apply after ops supplies verified mappings:
 *   { "mappings": [
 *     { "recordId": "cmt_...", "offeringId": "pkg_...", "verified": true },
 *     { "serviceScopeCode": "service:CAR_WASH", "offeringId": "pkg_...", "verified": true }
 *   ] }
 *
 *   pnpm exec ts-node --esm apps/vendor-service/src/scripts/backfill-capacity-scope-offering.ts \
 *     --table vendor-service-dev-vendor --mapping capacity-scope-mapping.json --apply
 *
 * Until migrated, rows without offeringId remain readable but are ineligible for
 * sold-capacity allocation and sales-control enablement.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { readFileSync, writeFileSync } from 'node:fs';

import type { PackageScope } from '../domain/capacity-commitment';
import {
  classifyCapacityScope,
  planCapacityScopeRepair,
  plansNeedingAttention,
  type CapacityScopeRepairPlan,
  type CapacityScopeSnapshot,
  type VerifiedOfferingMapping,
} from '../domain/capacity-scope-offering-backfill';
import {
  CAPACITY_COMMITMENT_ENTITY_TYPE,
  CAPACITY_PROPOSAL_ENTITY_TYPE,
} from '../utils/constants/vendor-key-builder';

interface ScopedItem {
  PK?: string;
  SK?: string;
  entityType?: string;
  proposalId?: string;
  commitmentId?: string;
  vendorId?: string;
  communityId?: string;
  packageScope?: PackageScope;
  scope?: PackageScope;
}

export interface CapacityScopeBackfillReport {
  dryRun: boolean;
  scannedItems: number;
  missingOfferingId: number;
  legacyServiceScopeCode: number;
  plans: CapacityScopeRepairPlan[];
  applied: string[];
  failed: Array<{ recordId: string; message: string }>;
}

export function snapshotsFromItems(items: ScopedItem[]): CapacityScopeSnapshot[] {
  const snapshots: CapacityScopeSnapshot[] = [];
  for (const item of items) {
    if (!item.PK || !item.SK || !item.vendorId || !item.communityId) continue;
    if (item.entityType === CAPACITY_PROPOSAL_ENTITY_TYPE && item.proposalId && item.packageScope) {
      snapshots.push({
        kind: 'CapacityProposal',
        recordId: item.proposalId,
        vendorId: item.vendorId,
        communityId: item.communityId,
        scope: item.packageScope,
        pk: item.PK,
        sk: item.SK,
      });
    } else if (
      item.entityType === CAPACITY_COMMITMENT_ENTITY_TYPE
      && item.commitmentId
      && item.scope
    ) {
      snapshots.push({
        kind: 'CapacityCommitment',
        recordId: item.commitmentId,
        vendorId: item.vendorId,
        communityId: item.communityId,
        scope: item.scope,
        pk: item.PK,
        sk: item.SK,
      });
    }
  }
  return snapshots;
}

export function buildReport(
  items: ScopedItem[],
  mappings: readonly VerifiedOfferingMapping[],
  dryRun: boolean,
): CapacityScopeBackfillReport {
  const snapshots = snapshotsFromItems(items);
  let missingOfferingId = 0;
  let legacyServiceScopeCode = 0;
  const plans: CapacityScopeRepairPlan[] = [];
  for (const snapshot of snapshots) {
    const flags = classifyCapacityScope(snapshot);
    if (flags.missingOfferingId) missingOfferingId += 1;
    if (flags.hasLegacyServiceScopeCode) legacyServiceScopeCode += 1;
    plans.push(planCapacityScopeRepair(snapshot, mappings));
  }
  return {
    dryRun,
    scannedItems: snapshots.length,
    missingOfferingId,
    legacyServiceScopeCode,
    plans: plansNeedingAttention(plans),
    applied: [],
    failed: [],
  };
}

async function scanAll(
  doc: DynamoDBDocumentClient,
  tableName: string,
): Promise<ScopedItem[]> {
  const items: ScopedItem[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey,
        FilterExpression: 'entityType = :proposal OR entityType = :commitment',
        ExpressionAttributeValues: {
          ':proposal': CAPACITY_PROPOSAL_ENTITY_TYPE,
          ':commitment': CAPACITY_COMMITMENT_ENTITY_TYPE,
        },
      }),
    );
    items.push(...((page.Items ?? []) as ScopedItem[]));
    ExclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return items;
}

async function applySetOfferingId(
  doc: DynamoDBDocumentClient,
  tableName: string,
  snapshot: CapacityScopeSnapshot,
  nextScope: PackageScope,
): Promise<void> {
  const attr = snapshot.kind === 'CapacityProposal' ? 'packageScope' : 'scope';
  await doc.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: snapshot.pk, SK: snapshot.sk },
      UpdateExpression: 'SET #scope = :scope, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#scope': attr },
      ExpressionAttributeValues: {
        ':scope': nextScope,
        ':updatedAt': new Date().toISOString(),
      },
      // Fail closed if another writer already set offeringId.
      ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(#scope.offeringId)',
    }),
  );
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    table: get('--table'),
    out: get('--out') ?? 'capacity-scope-report.json',
    mappingPath: get('--mapping'),
    apply: argv.includes('--apply'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.table) {
    throw new Error('--table is required');
  }
  let mappings: VerifiedOfferingMapping[] = [];
  if (args.mappingPath) {
    const raw = JSON.parse(readFileSync(args.mappingPath, 'utf8')) as {
      mappings?: VerifiedOfferingMapping[];
    };
    mappings = raw.mappings ?? [];
  }

  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const items = await scanAll(doc, args.table);
  const report = buildReport(items, mappings, !args.apply);
  const snapshots = snapshotsFromItems(items);
  const byId = new Map(snapshots.map((item) => [item.recordId, item]));

  if (args.apply) {
    for (const plan of report.plans) {
      if (plan.action !== 'setOfferingId' || !plan.nextScope) continue;
      const snapshot = byId.get(plan.recordId);
      if (!snapshot) continue;
      try {
        await applySetOfferingId(doc, args.table, snapshot, plan.nextScope);
        report.applied.push(plan.recordId);
      } catch (error) {
        report.failed.push({
          recordId: plan.recordId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    report.dryRun = false;
  }

  writeFileSync(args.out, JSON.stringify(report, null, 2));
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        out: args.out,
        dryRun: report.dryRun,
        scannedItems: report.scannedItems,
        missingOfferingId: report.missingOfferingId,
        needingAttention: report.plans.length,
        applied: report.applied.length,
        failed: report.failed.length,
      },
      null,
      2,
    ),
  );
}

const invokedDirectly = process.argv[1]?.includes('backfill-capacity-scope-offering');
if (invokedDirectly) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  });
}
