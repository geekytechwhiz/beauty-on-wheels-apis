/**
 * Idempotent backfill for vendor operational work indexes used by home-summary.
 *
 * 1) PackageVisit rows with a schedule date and status !== UNSCHEDULED missing GSI3:
 *    GSI3PK = VENDOR#{vendorId}#DATE#{date}
 *    GSI3SK = VISIT#{startTime}#{visitId}
 *
 * 2) Booking / CustomerBooking / VendorBooking projections with planId and no
 *    schedule.date whose GSI1SK is still BOOKING#{legacyDate}#{id}:
 *    rewrite GSI1SK to BOOKING#UNSCHEDULED#{id}
 *    (bookingDate may still hold a legacy activation day or a later-synced
 *    earliest service date; this backfill only fixes the GSI1 sort key)
 *
 * Dry-run by default. Does not delete the table or indexes. Safe to resume:
 * already-correct items are skipped; --start-key resumes a prior ExclusiveStartKey.
 *
 * Report only:
 *   pnpm exec ts-node --transpile-only apps/booking-service/src/scripts/backfill-vendor-work-indexes.ts \
 *     --table booking-service-dev-booking
 *
 * Apply:
 *   pnpm exec ts-node --transpile-only apps/booking-service/src/scripts/backfill-vendor-work-indexes.ts \
 *     --table booking-service-dev-booking --apply
 *
 * Resume:
 *   ... --start-key '{"PK":"...","SK":"..."}'
 *
 * Deploy order: ensure GSI3 is ACTIVE on the booking table before relying on
 * home-summary day queries; run this backfill after that; then cut over traffic.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
  type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';

interface BackfillItem {
  PK?: string;
  SK?: string;
  entityType?: string;
  id?: string;
  visitId?: string;
  vendorId?: string;
  planId?: string;
  status?: string;
  bookingDate?: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI3PK?: string;
  GSI3SK?: string;
  schedule?: { date?: string; startTime?: string };
}

export interface VendorWorkBackfillReport {
  dryRun: boolean;
  scannedItems: number;
  visitsNeedingGsi3: number;
  bookingsNeedingUnscheduledSk: number;
  applied: string[];
  skipped: number;
  failed: Array<{ key: string; message: string }>;
  lastEvaluatedKey?: Record<string, NativeAttributeValue>;
}

function parseArgs(argv: string[]) {
  const tableIdx = argv.indexOf('--table');
  const table = tableIdx >= 0 ? argv[tableIdx + 1] : process.env.DYNAMODB_TABLE_NAME;
  const apply = argv.includes('--apply');
  const startIdx = argv.indexOf('--start-key');
  const startKey = startIdx >= 0 ? JSON.parse(argv[startIdx + 1]) as Record<string, NativeAttributeValue> : undefined;
  const pageSizeIdx = argv.indexOf('--page-size');
  const pageSize = pageSizeIdx >= 0 ? Number(argv[pageSizeIdx + 1]) : 100;
  if (!table) throw new Error('--table or DYNAMODB_TABLE_NAME is required');
  return { table, apply, startKey, pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 100 };
}

export function planVisitGsi3(item: BackfillItem): { GSI3PK: string; GSI3SK: string } | null {
  if (item.entityType !== 'PackageVisit') return null;
  const date = item.schedule?.date?.trim()
    || (item as BackfillItem & { scheduleStartDate?: string }).scheduleStartDate?.trim();
  if (!date || item.status === 'UNSCHEDULED' || !item.vendorId || !item.visitId) return null;
  const startTime = item.schedule?.startTime?.trim() || '00:00';
  const expectedPk = `VENDOR#${item.vendorId}#DATE#${date}`;
  const expectedSk = `VISIT#${startTime}#${item.visitId}`;
  if (item.GSI3PK === expectedPk && item.GSI3SK === expectedSk) return null;
  return { GSI3PK: expectedPk, GSI3SK: expectedSk };
}

export function planBookingUnscheduledSk(item: BackfillItem): string | null {
  const types = new Set(['Booking', 'CustomerBooking', 'VendorBooking']);
  if (!item.entityType || !types.has(item.entityType)) return null;
  if (!item.planId?.trim()) return null;
  if (item.schedule?.date?.trim()) return null;
  const id = item.id?.trim();
  if (!id || !item.GSI1SK) return null;
  const desired = `BOOKING#UNSCHEDULED#${id}`;
  if (item.GSI1SK === desired) return null;
  if (!/^BOOKING#\d{4}-\d{2}-\d{2}#/.test(item.GSI1SK)) return null;
  return desired;
}

export async function runBackfill(input: {
  table: string;
  apply: boolean;
  startKey?: Record<string, NativeAttributeValue>;
  pageSize: number;
  client?: DynamoDBDocumentClient;
}): Promise<VendorWorkBackfillReport> {
  const doc = input.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const report: VendorWorkBackfillReport = {
    dryRun: !input.apply,
    scannedItems: 0,
    visitsNeedingGsi3: 0,
    bookingsNeedingUnscheduledSk: 0,
    applied: [],
    skipped: 0,
    failed: [],
  };

  let exclusiveStartKey = input.startKey;
  do {
    const page = await doc.send(new ScanCommand({
      TableName: input.table,
      ExclusiveStartKey: exclusiveStartKey,
      Limit: input.pageSize,
      FilterExpression: 'entityType IN (:visit, :booking, :customerBooking, :vendorBooking)',
      ExpressionAttributeValues: {
        ':visit': 'PackageVisit',
        ':booking': 'Booking',
        ':customerBooking': 'CustomerBooking',
        ':vendorBooking': 'VendorBooking',
      },
    }));
    exclusiveStartKey = page.LastEvaluatedKey;
    report.lastEvaluatedKey = page.LastEvaluatedKey;

    for (const raw of page.Items ?? []) {
      const item = raw as BackfillItem;
      report.scannedItems += 1;
      const key = `${item.PK ?? ''} / ${item.SK ?? ''}`;

      const gsi3 = planVisitGsi3(item);
      if (gsi3) {
        report.visitsNeedingGsi3 += 1;
        if (!input.apply) continue;
        try {
          await doc.send(new UpdateCommand({
            TableName: input.table,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: 'SET GSI3PK = :pk, GSI3SK = :sk',
            ConditionExpression: 'attribute_exists(PK)',
            ExpressionAttributeValues: { ':pk': gsi3.GSI3PK, ':sk': gsi3.GSI3SK },
          }));
          report.applied.push(`visit-gsi3:${key}`);
        } catch (error) {
          report.failed.push({ key, message: error instanceof Error ? error.message : String(error) });
        }
        continue;
      }

      const nextSk = planBookingUnscheduledSk(item);
      if (nextSk) {
        report.bookingsNeedingUnscheduledSk += 1;
        if (!input.apply) continue;
        try {
          await doc.send(new UpdateCommand({
            TableName: input.table,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: 'SET GSI1SK = :sk',
            ConditionExpression: 'attribute_exists(PK) AND attribute_exists(planId)',
            ExpressionAttributeValues: { ':sk': nextSk },
          }));
          report.applied.push(`booking-sk:${key}`);
        } catch (error) {
          report.failed.push({ key, message: error instanceof Error ? error.message : String(error) });
        }
        continue;
      }

      report.skipped += 1;
    }
  } while (exclusiveStartKey);

  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runBackfill(args);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  if (report.failed.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  });
}
