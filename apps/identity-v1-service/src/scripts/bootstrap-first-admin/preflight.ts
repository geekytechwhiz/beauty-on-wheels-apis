import {
  DescribeTableCommand,
  type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { GetCallerIdentityCommand, type STSClient } from '@aws-sdk/client-sts';

import type { BootstrapCliArgs, PreflightResult } from './types';
import { BootstrapError } from './types';

export async function runPreflight(input: {
  args: BootstrapCliArgs;
  sts: STSClient;
  dynamo: DynamoDBClient;
  fetchImpl: typeof fetch;
  region: string;
}): Promise<PreflightResult> {
  const { args, sts, dynamo, fetchImpl, region } = input;

  if (args.expectedRegion && args.expectedRegion !== region) {
    throw new BootstrapError(
      `Region mismatch: expected ${args.expectedRegion}, session is ${region}`,
      'REGION_MISMATCH',
    );
  }

  let accountId: string;
  try {
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    accountId = identity.Account?.trim() ?? '';
  } catch (error) {
    throw new BootstrapError(
      'Unable to resolve AWS caller identity; check credentials before OTP',
      'STS_FAILED',
      { cause: error },
    );
  }

  if (!accountId) {
    throw new BootstrapError(
      'STS returned an empty account id',
      'STS_ACCOUNT_MISSING',
    );
  }

  if (accountId !== args.expectedAccountId) {
    throw new BootstrapError(
      `AWS account mismatch: expected ${args.expectedAccountId}, session is ${accountId}`,
      'ACCOUNT_MISMATCH',
    );
  }

  let tableStatus: string;
  try {
    const described = await dynamo.send(
      new DescribeTableCommand({ TableName: args.table }),
    );
    tableStatus = described.Table?.TableStatus ?? 'UNKNOWN';
  } catch (error) {
    throw new BootstrapError(
      `Identity table ${args.table} is not readable in this account/region`,
      'TABLE_DESCRIBE_FAILED',
      { cause: error },
    );
  }

  if (tableStatus !== 'ACTIVE') {
    throw new BootstrapError(
      `Identity table status is ${tableStatus}; refuse to bootstrap`,
      'TABLE_NOT_ACTIVE',
    );
  }

  let identityApiReachable = false;
  try {
    const healthUrl = `${args.apiBaseUrl}/health`;
    const response = await fetchImpl(healthUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    // Any HTTP response from the Identity base means DNS/TLS/routing works.
    // 404 on /health is acceptable when the stage omits that route.
    identityApiReachable = response.status > 0;
  } catch (error) {
    throw new BootstrapError(
      `Identity API base URL is not reachable: ${args.apiBaseUrl}`,
      'API_UNREACHABLE',
      { cause: error },
    );
  }

  return {
    stage: args.stage,
    tableName: args.table,
    region,
    accountId,
    apiBaseUrl: args.apiBaseUrl,
    tableStatus,
    identityApiReachable,
  };
}
