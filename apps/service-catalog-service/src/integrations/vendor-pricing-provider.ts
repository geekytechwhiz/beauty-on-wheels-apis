import { BaseError } from "@api-hub/utils";
import { createChildLogger, createLogger } from "@api-hub/observability";

import { env } from "../configs/env.config";

const logger = createChildLogger(
  createLogger({ service: "service-catalog-service", redactPII: true }),
  { component: "VendorPricingProvider" },
);

export interface VendorOfferingPrice {
  enabled: boolean;
  priceOverride?: number;
}

export interface VendorPricingSnapshot {
  services: ReadonlyMap<string, VendorOfferingPrice>;
  packages: ReadonlyMap<string, VendorOfferingPrice>;
}

/**
 * Reads provider price overrides from Vendor Service.
 * Catalog does not read the vendor table.
 *
 * Dependency: `GET {VENDOR_SERVICE_URL}/vendors/{vendorId}/capabilities`.
 * That route is currently limited to the vendor owner or an admin. A customer
 * token receives 403, and this adapter fails the calculation instead of
 * inventing overrides. Identity must expose a service principal that can read
 * provider pricing before customer checkout can apply overrides.
 */
export interface VendorPricingProvider {
  getPricing(
    vendorId: string,
    authorizationHeader?: string,
  ): Promise<VendorPricingSnapshot>;
}

interface VendorCapabilitiesPayload {
  services?: Array<{
    serviceId?: string;
    enabled?: boolean;
    priceOverride?: number;
  }>;
  packages?: Array<{
    packageId?: string;
    enabled?: boolean;
    priceOverride?: number;
  }>;
}

export class HttpVendorPricingProvider implements VendorPricingProvider {
  async getPricing(
    vendorId: string,
    authorizationHeader?: string,
  ): Promise<VendorPricingSnapshot> {
    const base = env.VENDOR_SERVICE_URL?.trim().replace(/\/$/, "");
    if (!base) {
      throw new BaseError(
        "VENDOR_SERVICE_URL is not configured. Provider price overrides cannot be read.",
        503,
        "VENDOR_PRICING_UNAVAILABLE",
      );
    }

    const url = `${base}/vendors/${encodeURIComponent(vendorId)}/capabilities`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: authorizationHeader
          ? { Authorization: authorizationHeader }
          : undefined,
        signal: AbortSignal.timeout(4000),
      });
    } catch (error) {
      logger.error({
        event: "vendor_pricing_unreachable",
        vendorId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BaseError(
        "Vendor Service could not be reached for provider pricing",
        502,
        "VENDOR_PRICING_UNAVAILABLE",
      );
    }

    if (response.status === 404) {
      throw new BaseError(
        `Vendor not found: ${vendorId}`,
        404,
        "VENDOR_NOT_FOUND",
      );
    }

    if (response.status === 401 || response.status === 403) {
      logger.warn({
        event: "vendor_pricing_forbidden",
        vendorId,
        statusCode: response.status,
      });
      throw new BaseError(
        "Vendor Service denied the provider pricing read. Catalog does not access vendor storage.",
        502,
        "VENDOR_PRICING_UNAVAILABLE",
      );
    }

    if (!response.ok) {
      logger.error({
        event: "vendor_pricing_failed",
        vendorId,
        statusCode: response.status,
      });
      throw new BaseError(
        "Vendor Service could not provide pricing overrides",
        502,
        "VENDOR_PRICING_UNAVAILABLE",
      );
    }

    const payload = await readCapabilities(response);
    return toSnapshot(payload);
  }
}

async function readCapabilities(response: Response): Promise<VendorCapabilitiesPayload> {
  try {
    const body = (await response.json()) as { data?: VendorCapabilitiesPayload } &
      VendorCapabilitiesPayload;
    return body.data ?? body;
  } catch {
    throw new BaseError(
      "Vendor Service returned an unreadable pricing response",
      502,
      "VENDOR_PRICING_UNAVAILABLE",
    );
  }
}

function toSnapshot(payload: VendorCapabilitiesPayload): VendorPricingSnapshot {
  const services = new Map<string, VendorOfferingPrice>();
  for (const entry of payload.services ?? []) {
    if (!entry.serviceId) {
      continue;
    }
    services.set(entry.serviceId, {
      enabled: entry.enabled !== false,
      ...(entry.priceOverride === undefined
        ? {}
        : { priceOverride: entry.priceOverride }),
    });
  }

  const packages = new Map<string, VendorOfferingPrice>();
  for (const entry of payload.packages ?? []) {
    if (!entry.packageId) {
      continue;
    }
    packages.set(entry.packageId, {
      enabled: entry.enabled !== false,
      ...(entry.priceOverride === undefined
        ? {}
        : { priceOverride: entry.priceOverride }),
    });
  }

  return { services, packages };
}

let provider: VendorPricingProvider | undefined;

export function getVendorPricingProvider(): VendorPricingProvider {
  if (!provider) {
    provider = new HttpVendorPricingProvider();
  }
  return provider;
}
