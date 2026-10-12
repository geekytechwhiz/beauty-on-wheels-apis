/**
 * Booking `offeringId` is a Service Catalog service id. Vendor Service does not
 * mint a second offering id. A vendor offering is the enabled flag and optional
 * price override stored against that same service id (or a catalog package id
 * when the priced selection is a package).
 *
 * `offeringVersion` is a server-owned integer stored on `OFFERING_REVISION`.
 * It increments when the catalog version, the applicable vendor pricing
 * version, or a dependency version changes. It is not the sum, maximum, or
 * a constant mix of those inputs.
 */
export interface OfferingDependencyVersion {
  id: string;
  version: number;
}

export interface OfferingRevision {
  offeringId: string;
  vendorId: string;
  offeringVersion: number;
  catalogVersion: number;
  vendorPricingVersion: number;
  dependencyVersions: OfferingDependencyVersion[];
}

export interface OfferingRevisionStore {
  findRevision(offeringId: string, vendorId: string): Promise<OfferingRevision | null>;
  putRevision(revision: OfferingRevision, expectedOfferingVersion?: number): Promise<void>;
}

/** No vendor overlay exists for this catalog id. Distinct from version 1. */
export const NO_VENDOR_PRICING_VERSION = 0;

export const MAX_OFFERING_REVISION_ATTEMPTS = 3;

export type OfferingRevisionInput = Omit<OfferingRevision, 'offeringVersion'>;

export function revisionsMatch(current: OfferingRevision, input: OfferingRevisionInput): boolean {
  return current.catalogVersion === input.catalogVersion
    && current.vendorPricingVersion === input.vendorPricingVersion
    && dependencyKey(current.dependencyVersions) === dependencyKey(input.dependencyVersions);
}

export function nextOfferingVersion(current: OfferingRevision | null): number {
  if (!current) {
    return 1;
  }
  if (!Number.isInteger(current.offeringVersion) || current.offeringVersion < 1) {
    throw new Error('Stored offering revision is not authoritative');
  }
  return current.offeringVersion + 1;
}

export function dependencyKey(values: readonly OfferingDependencyVersion[]): string {
  return [...values]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entry) => `${entry.id}:${entry.version}`)
    .join('|');
}
