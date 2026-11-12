import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { BaseError } from '@api-hub/utils';

import { env } from '../configs/env.config';

export interface CapacityCommitmentFact {
  commitmentId: string;
  vendorId: string;
  communityId: string;
  status: string;
  quantity: number;
  holdsCapacity: boolean;
  scope: {
    /** Required for sales-control enablement. Legacy rows may omit until migrated. */
    offeringId?: string;
    /** Legacy only; readable when present, never used for eligibility. */
    serviceScopeCode?: string;
    label: string;
  };
}

export interface VendorCapacityCommitmentSource {
  /**
   * Facts for the requested commitment ids. Missing ids are omitted.
   * Fails closed when Vendor Service cannot be read.
   */
  lookup(commitmentIds: readonly string[]): Promise<CapacityCommitmentFact[]>;
}

export function parseCapacityCommitmentFacts(
  payload: unknown,
  requested: readonly string[],
): CapacityCommitmentFact[] {
  const envelope = asRecord(payload);
  if (envelope.error) {
    throw commitmentFailure(envelope.error);
  }
  const body = asRecord(envelope.data ?? payload);
  if (!Array.isArray(body.commitments)) {
    throw unavailable('Vendor Service omitted capacity commitment facts');
  }
  const allowed = new Set(requested);
  const facts: CapacityCommitmentFact[] = [];
  const seen = new Set<string>();
  for (const raw of body.commitments) {
    const row = asRecord(raw);
    const commitmentId =
      typeof row.commitmentId === 'string' ? row.commitmentId.trim() : '';
    if (!commitmentId || !allowed.has(commitmentId) || seen.has(commitmentId)) {
      throw unavailable('Vendor Service returned an invalid capacity commitment id');
    }
    if (typeof row.vendorId !== 'string' || !row.vendorId.trim()) {
      throw unavailable('Vendor Service omitted commitment vendorId');
    }
    if (typeof row.communityId !== 'string' || !row.communityId.trim()) {
      throw unavailable('Vendor Service omitted commitment communityId');
    }
    if (typeof row.status !== 'string' || !row.status.trim()) {
      throw unavailable('Vendor Service omitted commitment status');
    }
    if (typeof row.holdsCapacity !== 'boolean') {
      throw unavailable('Vendor Service omitted commitment holdsCapacity');
    }
    if (typeof row.quantity !== 'number' || !Number.isInteger(row.quantity) || row.quantity < 1) {
      throw unavailable('Vendor Service returned an invalid commitment quantity');
    }
    const scope = asRecord(row.scope);
    if (typeof scope.label !== 'string' || !scope.label.trim()) {
      throw unavailable('Vendor Service omitted commitment scope label');
    }
    seen.add(commitmentId);
    facts.push({
      commitmentId,
      vendorId: row.vendorId.trim(),
      communityId: row.communityId.trim(),
      status: row.status.trim(),
      quantity: row.quantity,
      holdsCapacity: row.holdsCapacity,
      scope: {
        label: scope.label.trim(),
        ...(typeof scope.offeringId === 'string' && scope.offeringId.trim()
          ? { offeringId: scope.offeringId.trim() }
          : {}),
        ...(typeof scope.serviceScopeCode === 'string' && scope.serviceScopeCode.trim()
          ? { serviceScopeCode: scope.serviceScopeCode.trim() }
          : {}),
      },
    });
  }
  return facts;
}

export class LambdaVendorCapacityCommitmentSource implements VendorCapacityCommitmentSource {
  constructor(private readonly lambda: LambdaClient = new LambdaClient({})) {}

  async lookup(commitmentIds: readonly string[]): Promise<CapacityCommitmentFact[]> {
    if (commitmentIds.length === 0) {
      return [];
    }
    const functionName = env.VENDOR_CAPACITY_COMMITMENT_FUNCTION?.trim() ?? '';
    if (!functionName) {
      throw unavailable('Capacity commitment lookup is not configured');
    }
    let output;
    try {
      // Lambda invoke, not DynamoDB.
      // eslint-disable-next-line mvrx/no-direct-dynamodb
      output = await this.lambda.send(new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify({ commitmentIds })),
      }));
    } catch (error) {
      throw unavailable(
        error instanceof Error ? error.message : 'Capacity commitments could not be read',
      );
    }
    if (output.FunctionError) {
      throw unavailable('Vendor Service failed while reading capacity commitments');
    }
    const raw = output.Payload ? Buffer.from(output.Payload).toString('utf8') : '';
    let parsed: unknown = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw unavailable('Vendor Service returned unreadable capacity commitments');
      }
    }
    return parseCapacityCommitmentFacts(parsed, commitmentIds);
  }
}

function commitmentFailure(error: unknown): BaseError {
  const record = asRecord(error);
  const message = typeof record.message === 'string' && record.message.trim()
    ? record.message
    : 'Vendor Service could not provide capacity commitments';
  return unavailable(message);
}

function unavailable(message: string): BaseError {
  return new BaseError(message, 503, 'CAPACITY_COMMITMENT_UNAVAILABLE', undefined, {
    retryable: true,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

let source: VendorCapacityCommitmentSource | undefined;

export function getVendorCapacityCommitmentSource(): VendorCapacityCommitmentSource {
  if (!source) {
    source = new LambdaVendorCapacityCommitmentSource();
  }
  return source;
}
