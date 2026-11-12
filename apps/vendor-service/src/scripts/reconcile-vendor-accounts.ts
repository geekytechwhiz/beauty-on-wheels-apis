/**
 * Idempotent recovery for vendors missing account linkage.
 *
 * Dry run (default):
 *   pnpm exec ts-node --esm apps/vendor-service/src/scripts/reconcile-vendor-accounts.ts \
 *     --table vendor-service-dev-vendor --bus nvdev-bw-vendor-event-bus
 *
 * Apply after review: append --apply.
 *
 * Rules:
 * - Uses explicit loginPhoneNumber only (never createdBy / business phone).
 * - Records without loginPhoneNumber are reported as ambiguous and skipped.
 * - Publishes Vendor.AccountProvisioningRequested (Identity reuses Cognito/users).
 * - Does not mint or resend email verification OTPs.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

type Vendor = {
  vendorId?: string;
  SK?: string;
  entityType?: string;
  loginPhoneNumber?: string;
  contactName?: string;
  businessName?: string;
  email?: string;
  identityId?: string;
  accountProvisioningStatus?: string;
  PK?: string;
};

const option = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};

async function main() {
  const table = option('--table');
  const bus = option('--bus');
  const apply = process.argv.includes('--apply');
  if (!table || !bus) {
    throw new Error('--table and --bus are required');
  }

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const candidates: Vendor[] = [];
  let key: Record<string, unknown> | undefined;

  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: table,
        ExclusiveStartKey: key,
        FilterExpression: 'entityType = :vendor AND SK = :profile',
        ExpressionAttributeValues: {
          ':vendor': 'Vendor',
          ':profile': 'PROFILE',
        },
      }),
    );
    key = page.LastEvaluatedKey;
    for (const item of page.Items ?? []) {
      const v = item as Vendor;
      if (v.accountProvisioningStatus !== 'COMPLETED' || !v.identityId) {
        candidates.push(v);
      }
    }
  } while (key);

  const actionable = candidates.filter(
    (v) => v.vendorId && v.loginPhoneNumber?.trim(),
  );
  const ambiguous = candidates.filter(
    (v) => !v.vendorId || !v.loginPhoneNumber?.trim(),
  );

  console.log(
    JSON.stringify(
      {
        dryRun: !apply,
        candidates: actionable.map((v) => ({
          vendorId: v.vendorId,
          status: v.accountProvisioningStatus ?? 'MISSING',
          hasIdentityId: Boolean(v.identityId),
        })),
        ambiguous: ambiguous.map((v) => ({
          vendorId: v.vendorId,
          reason: 'missing explicit loginPhoneNumber',
        })),
      },
      null,
      2,
    ),
  );

  if (!apply || !actionable.length) {
    return;
  }

  const eb = new EventBridgeClient({});
  const now = new Date().toISOString();

  for (const v of actionable) {
    // Deliberate retry token so a future stream MODIFY can also resume if needed.
    await ddb.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: v.PK ?? `VENDOR#${v.vendorId}`, SK: 'PROFILE' },
        UpdateExpression:
          'SET accountProvisioningRetryRequestedAt = :retry, accountProvisioningStatus = if_not_exists(accountProvisioningStatus, :pending)',
        ExpressionAttributeValues: {
          ':retry': now,
          ':pending': 'PENDING',
        },
      }),
    );

    await eb.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: bus,
            Source: 'vendor-service',
            DetailType: 'Vendor.AccountProvisioningRequested',
            Detail: JSON.stringify({
              eventId: `reconcile:${v.vendorId}:${now}`,
              eventType: 'Vendor.AccountProvisioningRequested',
              eventVersion: '1.0.0',
              source: 'vendor-service',
              timestamp: now,
              idempotencyKey: `Vendor.AccountProvisioningRequested:${v.vendorId}`,
              payload: {
                vendorId: v.vendorId,
                loginPhoneNumber: v.loginPhoneNumber!.trim(),
                displayName:
                  v.contactName?.trim() ||
                  v.businessName?.trim() ||
                  'Vendor',
                ...(v.email ? { email: v.email } : {}),
              },
              meta: { correlationId: `reconcile:${v.vendorId}` },
            }),
          },
        ],
      }),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
