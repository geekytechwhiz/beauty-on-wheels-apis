import { ValidationError } from '@api-hub/utils';

import { env } from '../configs/env.config';

export interface CatalogServiceCheck {
  serviceId: string;
  categoryId: string;
  enabled: boolean;
}

export interface CatalogPackageCheck {
  packageId: string;
  enabled: boolean;
}

export interface CatalogEntityLookup {
  assertServicesExist(
    services: readonly CatalogServiceCheck[],
    authorizationHeader?: string,
  ): Promise<void>;
  assertPackagesExist(
    packages: readonly CatalogPackageCheck[],
    authorizationHeader?: string,
  ): Promise<void>;
}

export class CatalogUnavailableError extends Error {
  readonly statusCode = 502;
  readonly code = 'BAD_GATEWAY';
  readonly retryable = true;

  constructor(message = 'Catalog service could not validate the mapping') {
    super(message);
    this.name = 'CatalogUnavailableError';
  }
}

function catalogBaseUrl(): string {
  const base = env.CATALOG_SERVICE_URL?.trim().replace(/\/$/, '');
  if (!base) {
    throw new CatalogUnavailableError(
      'CATALOG_SERVICE_URL is not configured; catalog mappings cannot be validated',
    );
  }
  return base;
}

async function readActiveFlag(response: Response): Promise<boolean | undefined> {
  try {
    const body = (await response.json()) as { active?: unknown };
    return typeof body?.active === 'boolean' ? body.active : undefined;
  } catch {
    return undefined;
  }
}

async function assertExists(input: {
  url: string;
  authorizationHeader?: string;
  unknownMessage: string;
  inactiveMessage: string;
  enabled: boolean;
}): Promise<void> {
  let response: Response;
  try {
    response = await fetch(input.url, {
      method: 'GET',
      headers: input.authorizationHeader
        ? { Authorization: input.authorizationHeader }
        : undefined,
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    throw new CatalogUnavailableError();
  }

  if (response.status === 404) {
    throw new ValidationError(input.unknownMessage);
  }

  if (!response.ok) {
    throw new CatalogUnavailableError();
  }

  const active = await readActiveFlag(response);
  if (input.enabled && active === false) {
    throw new ValidationError(input.inactiveMessage);
  }
}

export class HttpCatalogEntityLookup implements CatalogEntityLookup {
  async assertServicesExist(
    services: readonly CatalogServiceCheck[],
    authorizationHeader?: string,
  ): Promise<void> {
    if (services.length === 0) {
      return;
    }
    const base = catalogBaseUrl();
    await Promise.all(
      services.map((service) => {
        const url = new URL(
          `${base}/services/${encodeURIComponent(service.serviceId)}`,
        );
        url.searchParams.set('categoryId', service.categoryId);
        return assertExists({
          url: url.toString(),
          authorizationHeader,
          enabled: service.enabled,
          unknownMessage: `Unknown catalog service: ${service.serviceId}`,
          inactiveMessage: `Catalog service is not active: ${service.serviceId}`,
        });
      }),
    );
  }

  async assertPackagesExist(
    packages: readonly CatalogPackageCheck[],
    authorizationHeader?: string,
  ): Promise<void> {
    if (packages.length === 0) {
      return;
    }
    const base = catalogBaseUrl();
    await Promise.all(
      packages.map((pkg) =>
        assertExists({
          url: `${base}/packages/${encodeURIComponent(pkg.packageId)}`,
          authorizationHeader,
          enabled: pkg.enabled,
          unknownMessage: `Unknown catalog package: ${pkg.packageId}`,
          inactiveMessage: `Catalog package is not active: ${pkg.packageId}`,
        }),
      ),
    );
  }
}

let lookup: CatalogEntityLookup | undefined;

export function getCatalogEntityLookup(): CatalogEntityLookup {
  if (!lookup) {
    lookup = new HttpCatalogEntityLookup();
  }
  return lookup;
}
