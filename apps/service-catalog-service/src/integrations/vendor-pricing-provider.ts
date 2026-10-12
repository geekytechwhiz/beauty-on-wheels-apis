import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { BaseError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { env } from '../configs/env.config';

const logger = createChildLogger(
  createLogger({ service: 'service-catalog-service', redactPII: true }),
  { component: 'VendorPricingProvider' },
);

export interface VendorOfferingPrice {
  enabled: boolean;
  priceOverride?: number;
  version: number;
}

export interface VendorPricingSnapshot {
  configurationVersion: number;
  services: ReadonlyMap<string, VendorOfferingPrice>;
  packages: ReadonlyMap<string, VendorOfferingPrice>;
}

/**
 * Reads provider price overrides by invoking Vendor Service.
 * The function is IAM-authorized for same-account application roles.
 * Catalog does not call the owner HTTP API and does not read the vendor table.
 */
export interface VendorPricingProvider {
  getPricing(vendorId: string): Promise<VendorPricingSnapshot>;
}

export class LambdaVendorPricingProvider implements VendorPricingProvider {
  constructor(private readonly lambda: LambdaClient = new LambdaClient({})) {}

  async getPricing(vendorId: string): Promise<VendorPricingSnapshot> {
    const functionName = env.VENDOR_PRICING_CONFIGURATION_FUNCTION?.trim() ?? '';
    if (!functionName) {
      throw new BaseError(
        'VENDOR_PRICING_CONFIGURATION_FUNCTION is not configured',
        503,
        'VENDOR_PRICING_UNAVAILABLE',
      );
    }

    let output;
    try {
      // Lambda invoke, not DynamoDB. The shared lint rule treats every client.send() call as a table access.
      // eslint-disable-next-line mvrx/no-direct-dynamodb
      output = await this.lambda.send(new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify({ vendorId })),
      }));
    } catch (error) {
      logger.error({
        event: 'vendor_pricing_unreachable',
        vendorId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BaseError(
        'Vendor Service could not be invoked for provider pricing',
        502,
        'VENDOR_PRICING_UNAVAILABLE',
      );
    }

    if (output.FunctionError) {
      throw new BaseError(
        'Vendor Service failed while reading provider pricing',
        502,
        'VENDOR_PRICING_UNAVAILABLE',
      );
    }

    const raw = output.Payload ? Buffer.from(output.Payload).toString('utf8') : '';
    let parsed: unknown = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw new BaseError(
          'Vendor Service returned an unreadable pricing response',
          502,
          'VENDOR_PRICING_UNAVAILABLE',
        );
      }
    }
    return parsePricingConfiguration(parsed, vendorId);
  }
}

export function parsePricingConfiguration(payload: unknown, vendorId: string): VendorPricingSnapshot {
  const envelope = asRecord(payload);
  if (envelope.error) {
    throw pricingFailure(envelope.error);
  }
  const body = asRecord(envelope.data ?? payload);
  if (body.vendorId !== undefined && body.vendorId !== vendorId) {
    throw new BaseError(
      'Vendor Service returned pricing for a different vendor',
      502,
      'VENDOR_PRICING_UNAVAILABLE',
    );
  }
  const configurationVersion = requireVersion(body.configurationVersion, 'configuration');
  return {
    configurationVersion,
    services: toOfferings(body.services, 'serviceId'),
    packages: toOfferings(body.packages, 'packageId'),
  };
}

function toOfferings(value: unknown, idField: 'serviceId' | 'packageId'): Map<string, VendorOfferingPrice> {
  if (!Array.isArray(value)) {
    throw new BaseError(
      'Vendor Service omitted pricing offerings',
      502,
      'VENDOR_PRICING_UNAVAILABLE',
    );
  }
  const offerings = new Map<string, VendorOfferingPrice>();
  for (const entry of value) {
    const record = asRecord(entry);
    const id = record[idField];
    if (typeof id !== 'string' || id.trim() === '') {
      throw new BaseError(
        'Vendor Service returned a pricing offering without an id',
        502,
        'VENDOR_PRICING_UNAVAILABLE',
      );
    }
    if (typeof record.enabled !== 'boolean') {
      throw new BaseError(
        `Vendor Service omitted enabled for ${id}`,
        502,
        'VENDOR_PRICING_UNAVAILABLE',
      );
    }
    offerings.set(id, {
      enabled: record.enabled,
      ...(typeof record.priceOverride === 'number' ? { priceOverride: record.priceOverride } : {}),
      version: requireVersion(record.version, id),
    });
  }
  return offerings;
}

function requireVersion(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new BaseError(
      `Vendor Service omitted an authoritative version for ${label}`,
      502,
      'VENDOR_PRICING_UNAVAILABLE',
    );
  }
  return value;
}

function pricingFailure(error: unknown): BaseError {
  const record = asRecord(error);
  const statusCode = typeof record.statusCode === 'number' ? record.statusCode : 502;
  const code = typeof record.code === 'string' && record.code.trim()
    ? record.code
    : 'VENDOR_PRICING_UNAVAILABLE';
  const message = typeof record.message === 'string' && record.message.trim()
    ? record.message
    : 'Vendor Service could not provide pricing overrides';
  if (statusCode >= 500) {
    return new BaseError(message, 502, 'VENDOR_PRICING_UNAVAILABLE');
  }
  return new BaseError(message, statusCode, code);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BaseError(
      'Vendor Service returned an unreadable pricing response',
      502,
      'VENDOR_PRICING_UNAVAILABLE',
    );
  }
  return value as Record<string, unknown>;
}

let provider: VendorPricingProvider | undefined;

export function getVendorPricingProvider(): VendorPricingProvider {
  if (!provider) {
    provider = new LambdaVendorPricingProvider();
  }
  return provider;
}
