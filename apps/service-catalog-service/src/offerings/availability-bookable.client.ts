import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { BaseError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { env } from '../configs/env.config';
import {
  BookableOfferingsRequest,
  OfferingAvailabilitySource,
} from './types';

const logger = createChildLogger(
  createLogger({ service: 'service-catalog-service', redactPII: true }),
  { component: 'OfferingAvailability' },
);

export class LambdaOfferingAvailability implements OfferingAvailabilitySource {
  constructor(private readonly lambda: LambdaClient = new LambdaClient({})) {}

  async findBookable(input: BookableOfferingsRequest): Promise<Set<string>> {
    const functionName = env.AVAILABILITY_BOOKABLE_FUNCTION?.trim() ?? '';
    if (!functionName) {
      throw new BaseError(
        'Availability filter is not configured',
        400,
        'AVAILABILITY_FILTER_UNAVAILABLE',
      );
    }

    let output;
    try {
      // Lambda invoke, not DynamoDB. The shared lint rule treats every client.send() call as a table access.
      // eslint-disable-next-line mvrx/no-direct-dynamodb
      output = await this.lambda.send(new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify(input)),
      }));
    } catch (error) {
      logger.error({
        event: 'offering_availability_unreachable',
        offeringCount: input.offerings.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw unavailable();
    }

    if (output.FunctionError) {
      throw unavailable();
    }

    const raw = output.Payload ? Buffer.from(output.Payload).toString('utf8') : '';
    let parsed: unknown = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw unavailable();
      }
    }
    return parseBookableKeys(parsed);
  }
}

export function parseBookableKeys(payload: unknown): Set<string> {
  const record = isRecord(payload) ? payload : undefined;
  const keys = record?.keys;
  if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string' || key.length === 0)) {
    throw unavailable();
  }
  return new Set(keys);
}

function unavailable(): BaseError {
  return new BaseError(
    'Availability could not be checked',
    502,
    'AVAILABILITY_UNAVAILABLE',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

let source: LambdaOfferingAvailability | undefined;

export function getOfferingAvailabilitySource(): LambdaOfferingAvailability {
  if (!source) {
    source = new LambdaOfferingAvailability();
  }
  return source;
}
