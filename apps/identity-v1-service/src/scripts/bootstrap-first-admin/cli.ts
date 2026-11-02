#!/usr/bin/env node
/**
 * Operator CLI: first-admin bootstrap for Identity Service.
 *
 * Dry-run by default. Does not deploy a public bootstrap endpoint.
 *
 * NODE_OPTIONS='--conditions=@api-hub/source' pnpm exec tsx \
 *   apps/identity-v1-service/src/scripts/bootstrap-first-admin/cli.ts \
 *   --stage dev \
 *   --table identity-table-dev \
 *   --api-base-url https://identity.example/dev \
 *   --destination admin@example.com \
 *   --approved-by alice@example.com \
 *   --executed-by bob@example.com \
 *   --change-ticket CHG-001 \
 *   --expected-account-id 123456789012
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { STSClient } from '@aws-sdk/client-sts';

import { parseBootstrapArgs } from './args';
import { promptHiddenOtp } from './prompt';
import { runFirstAdminBootstrap } from './saga';
import { sanitizeForLog } from './sanitize';
import { BootstrapError } from './types';

async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseBootstrapArgs(argv);
  const region =
    args.expectedRegion ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION;
  if (!region) {
    throw new BootstrapError(
      'Set AWS_REGION or AWS_DEFAULT_REGION (or pass --expected-region)',
      'REGION_REQUIRED',
    );
  }

  // Uses the AWS SDK default credential chain. Prefer an approved SSO or
  // assumed-role session; do not pass static credentials to this script.
  const dynamo = new DynamoDBClient({ region });
  const db = DynamoDBDocumentClient.from(dynamo, {
    marshallOptions: { removeUndefinedValues: true },
  });
  const sts = new STSClient({ region });

  const result = await runFirstAdminBootstrap({
    args,
    region,
    sts,
    dynamo,
    db,
    fetchImpl: fetch,
    promptOtp: promptHiddenOtp,
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(sanitizeForLog(result), null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    const message =
      error instanceof BootstrapError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'unknown error';
    const recoveryHint =
      error instanceof BootstrapError ? error.recoveryHint : undefined;
    // eslint-disable-next-line no-console
    console.error(
      `Bootstrap failed: ${message}${
        recoveryHint ? `\nRecovery: ${recoveryHint}` : ''
      }`,
    );
    process.exitCode = 1;
  });
}

export { main };
