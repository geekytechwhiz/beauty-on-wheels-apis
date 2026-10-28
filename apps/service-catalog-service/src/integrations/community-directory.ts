import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { BaseError } from '@api-hub/utils';

import { env } from '../configs/env.config';

export interface CommunityDirectorySource {
  /** Active directory ids among the requested ids. Fails closed when the directory cannot be read. */
  activeCommunityIds(communityIds: readonly string[]): Promise<string[]>;
}

export function parseActiveCommunityIds(payload: unknown, requested: readonly string[]): string[] {
  const envelope = asRecord(payload);
  if (envelope.error) {
    throw directoryFailure(envelope.error);
  }
  const body = asRecord(envelope.data ?? payload);
  if (!Array.isArray(body.communityIds)) {
    throw unavailable('Vendor Service omitted the community directory');
  }
  const allowed = new Set(requested);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of body.communityIds) {
    if (typeof value !== 'string' || !allowed.has(value) || seen.has(value)) {
      throw unavailable('Vendor Service returned an invalid community directory id');
    }
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

export class LambdaCommunityDirectorySource implements CommunityDirectorySource {
  constructor(private readonly lambda: LambdaClient = new LambdaClient({})) {}

  async activeCommunityIds(communityIds: readonly string[]): Promise<string[]> {
    if (communityIds.length === 0) {
      return [];
    }
    const functionName = env.COMMUNITY_DIRECTORY_FUNCTION?.trim() ?? '';
    if (!functionName) {
      throw unavailable('Community directory is not configured');
    }
    let output;
    try {
      // Lambda invoke, not DynamoDB.
      // eslint-disable-next-line mvrx/no-direct-dynamodb
      output = await this.lambda.send(new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify({ communityIds })),
      }));
    } catch (error) {
      throw unavailable(error instanceof Error ? error.message : 'Community directory could not be read');
    }
    if (output.FunctionError) {
      throw unavailable('Vendor Service failed while reading the community directory');
    }
    const raw = output.Payload ? Buffer.from(output.Payload).toString('utf8') : '';
    let parsed: unknown = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw unavailable('Vendor Service returned an unreadable community directory');
      }
    }
    return parseActiveCommunityIds(parsed, communityIds);
  }
}

function directoryFailure(error: unknown): BaseError {
  const record = asRecord(error);
  const message = typeof record.message === 'string' && record.message.trim()
    ? record.message
    : 'Vendor Service could not provide the community directory';
  return unavailable(message);
}

function unavailable(message: string): BaseError {
  return new BaseError(message, 503, 'COMMUNITY_DIRECTORY_UNAVAILABLE', undefined, { retryable: true });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

let source: CommunityDirectorySource | undefined;

export function getCommunityDirectorySource(): CommunityDirectorySource {
  if (!source) {
    source = new LambdaCommunityDirectorySource();
  }
  return source;
}
