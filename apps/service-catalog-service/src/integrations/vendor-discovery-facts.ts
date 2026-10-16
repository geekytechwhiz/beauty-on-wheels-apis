import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { BaseError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { env } from '../configs/env.config';
import { vendorStatusIsApproved } from '../domain/discovery-projection';
import {
  DiscoveryBranchState,
  DiscoveryPriceState,
  DiscoveryVendorState,
} from '../types/service-discovery.types';
import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';

const logger = createChildLogger(
  createLogger({ service: 'service-catalog-service', redactPII: true }),
  { component: 'VendorDiscoveryFacts' },
);

export interface DiscoveryFactsSnapshot {
  vendor: DiscoveryVendorState;
  branches: DiscoveryBranchState[];
  prices: DiscoveryPriceState[];
}

export interface DiscoveryFactsSource {
  /** Null when the vendor function is not configured. */
  load(vendorId: string): Promise<DiscoveryFactsSnapshot | null>;
}

export function parseDiscoveryFacts(payload: unknown, vendorId: string): DiscoveryFactsSnapshot {
  const envelope = asRecord(payload);
  if (envelope.error) {
    throw factsFailure(envelope.error);
  }
  const body = asRecord(envelope.data ?? payload);
  if (body.vendorId !== vendorId) {
    throw unavailable('Vendor Service returned discovery facts for a different vendor');
  }
  const status = requireText(body.status, 'status');
  const reviewedAt = requireText(body.reviewedAt, 'reviewedAt');
  const branches = Array.isArray(body.branches) ? body.branches : null;
  const services = Array.isArray(body.services) ? body.services : null;
  if (!branches || !services) {
    throw unavailable('Vendor Service omitted discovery branches or prices');
  }

  return {
    vendor: {
      PK: CatalogKeyBuilder.discoveryVendorPk(vendorId),
      SK: CatalogKeyBuilder.discoveryVendorSk(),
      entityType: 'DISCOVERY_VENDOR_STATE',
      vendorId,
      approved: vendorStatusIsApproved(status),
      reviewedAt,
      updatedAt: reviewedAt,
    },
    branches: branches.map((entry) => branchState(entry, vendorId)),
    prices: services.map((entry) => priceState(entry, vendorId)),
  };
}

export class LambdaDiscoveryFactsSource implements DiscoveryFactsSource {
  constructor(private readonly lambda: LambdaClient = new LambdaClient({})) {}

  async load(vendorId: string): Promise<DiscoveryFactsSnapshot | null> {
    const functionName = env.VENDOR_DISCOVERY_FACTS_FUNCTION?.trim() ?? '';
    if (!functionName) {
      return null;
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
        event: 'vendor_discovery_facts_unreachable',
        vendorId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw unavailable('Vendor Service could not be invoked for discovery facts');
    }

    if (output.FunctionError) {
      throw unavailable('Vendor Service failed while reading discovery facts');
    }
    const raw = output.Payload ? Buffer.from(output.Payload).toString('utf8') : '';
    let parsed: unknown = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw unavailable('Vendor Service returned unreadable discovery facts');
      }
    }
    return parseDiscoveryFacts(parsed, vendorId);
  }
}

function branchState(entry: unknown, vendorId: string): DiscoveryBranchState {
  const record = asRecord(entry);
  const branchId = requireText(record.branchId, 'branchId');
  if (typeof record.operational !== 'boolean') {
    throw unavailable(`Vendor Service omitted operational for ${branchId}`);
  }
  const updatedAt = requireText(record.updatedAt, 'updatedAt');
  const latitude = optionalCoordinate(record.latitude, 'latitude');
  const longitude = optionalCoordinate(record.longitude, 'longitude');
  const serviceRadiusKm = optionalRadius(record.serviceRadiusKm);
  return {
    PK: CatalogKeyBuilder.discoveryBranchPk(vendorId),
    SK: CatalogKeyBuilder.discoveryBranchSk(branchId),
    entityType: 'DISCOVERY_BRANCH_STATE',
    vendorId,
    branchId,
    operational: record.operational,
    ...(latitude === undefined ? {} : { latitude }),
    ...(longitude === undefined ? {} : { longitude }),
    ...(serviceRadiusKm === undefined ? {} : { serviceRadiusKm }),
    updatedAt,
  };
}

function priceState(entry: unknown, vendorId: string): DiscoveryPriceState {
  const record = asRecord(entry);
  const serviceId = requireText(record.serviceId, 'serviceId');
  if (typeof record.enabled !== 'boolean') {
    throw unavailable(`Vendor Service omitted enabled for ${serviceId}`);
  }
  const updatedAt = requireText(record.updatedAt, 'updatedAt');
  const priceOverride = record.priceOverride;
  if (priceOverride !== undefined && (typeof priceOverride !== 'number' || !Number.isFinite(priceOverride))) {
    throw unavailable(`Vendor Service returned an invalid price for ${serviceId}`);
  }
  return {
    PK: CatalogKeyBuilder.discoveryPricePk(vendorId),
    SK: CatalogKeyBuilder.discoveryPriceSk(serviceId),
    entityType: 'DISCOVERY_PRICE_STATE',
    vendorId,
    serviceId,
    enabled: record.enabled,
    ...(typeof priceOverride === 'number' ? { priceOverride } : {}),
    updatedAt,
  };
}

function optionalCoordinate(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw unavailable(`Vendor Service returned an invalid ${field}`);
  }
  return value;
}

function optionalRadius(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw unavailable('Vendor Service returned an invalid service radius');
  }
  return value;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw unavailable(`Vendor Service omitted ${field}`);
  }
  return value.trim();
}

function factsFailure(error: unknown): BaseError {
  const record = asRecord(error);
  const statusCode = typeof record.statusCode === 'number' ? record.statusCode : 502;
  const message = typeof record.message === 'string' && record.message.trim()
    ? record.message
    : 'Vendor Service could not provide discovery facts';
  if (statusCode === 404) {
    return new BaseError(message, 404, 'VENDOR_NOT_FOUND', undefined, { retryable: false });
  }
  if (statusCode >= 500) {
    return unavailable(message);
  }
  return new BaseError(
    message,
    statusCode,
    typeof record.code === 'string' && record.code.trim() ? record.code : 'VENDOR_DISCOVERY_UNAVAILABLE',
    undefined,
    { retryable: false },
  );
}

function unavailable(message: string): BaseError {
  return new BaseError(message, 502, 'VENDOR_DISCOVERY_UNAVAILABLE', undefined, { retryable: true });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unavailable('Vendor Service returned unreadable discovery facts');
  }
  return value as Record<string, unknown>;
}

let source: DiscoveryFactsSource | undefined;

export function getDiscoveryFactsSource(): DiscoveryFactsSource {
  if (!source) {
    source = new LambdaDiscoveryFactsSource();
  }
  return source;
}
