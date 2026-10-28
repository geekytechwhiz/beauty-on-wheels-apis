import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { BaseError } from '@api-hub/utils';

import { env } from '../configs/env.config';

export interface VendorCoverageSource {
  /** Active community ids for the vendor. Fails closed when coverage cannot be read. */
  activeCommunityIds(vendorId: string): Promise<string[]>;
}

/**
 * Reads community ids from the vendor discovery-facts invoke.
 * A missing list is not treated as "no communities": the check stops.
 */
export function parseVendorCoverage(payload: unknown, vendorId: string): string[] {
  const envelope = asRecord(payload);
  if (envelope.error) {
    throw coverageFailure(envelope.error);
  }
  const body = asRecord(envelope.data ?? payload);
  if (body.vendorId !== vendorId) {
    throw unavailable('Vendor Service returned coverage for a different vendor');
  }
  if (!Array.isArray(body.communityIds)) {
    throw unavailable('Vendor Service omitted community coverage');
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of body.communityIds) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw unavailable('Vendor Service returned an invalid community id');
    }
    const communityId = value.trim();
    if (!seen.has(communityId)) {
      seen.add(communityId);
      ids.push(communityId);
    }
  }
  return ids;
}

export class LambdaVendorCoverageSource implements VendorCoverageSource {
  constructor(private readonly lambda: LambdaClient = new LambdaClient({})) {}

  async activeCommunityIds(vendorId: string): Promise<string[]> {
    const functionName = env.VENDOR_DISCOVERY_FACTS_FUNCTION?.trim() ?? '';
    if (!functionName) {
      throw unavailable('Vendor coverage is not configured');
    }
    let output;
    try {
      // Lambda invoke, not DynamoDB.
      // eslint-disable-next-line mvrx/no-direct-dynamodb
      output = await this.lambda.send(new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify({ vendorId })),
      }));
    } catch (error) {
      throw unavailable(error instanceof Error ? error.message : 'Vendor coverage could not be read');
    }
    if (output.FunctionError) {
      throw unavailable('Vendor Service failed while reading community coverage');
    }
    const raw = output.Payload ? Buffer.from(output.Payload).toString('utf8') : '';
    let parsed: unknown = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw unavailable('Vendor Service returned unreadable community coverage');
      }
    }
    return parseVendorCoverage(parsed, vendorId);
  }
}

function coverageFailure(error: unknown): BaseError {
  const record = asRecord(error);
  const statusCode = typeof record.statusCode === 'number' ? record.statusCode : 502;
  const message = typeof record.message === 'string' && record.message.trim()
    ? record.message
    : 'Vendor Service could not provide community coverage';
  if (statusCode === 404) {
    return new BaseError(message, 404, 'VENDOR_NOT_FOUND', undefined, { retryable: false });
  }
  return unavailable(message);
}

function unavailable(message: string): BaseError {
  return new BaseError(message, 503, 'COVERAGE_UNAVAILABLE', undefined, { retryable: true });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

let source: VendorCoverageSource | undefined;

export function getVendorCoverageSource(): VendorCoverageSource {
  if (!source) {
    source = new LambdaVendorCoverageSource();
  }
  return source;
}
