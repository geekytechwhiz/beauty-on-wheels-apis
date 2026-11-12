import { ValidationError } from '@api-hub/utils';

import { isCatalogId } from './catalog-mapping';
import type { PackageScope } from './capacity-commitment';
import { packageScopeOfferingId } from './capacity-commitment';

/**
 * Explicit migration for capacity proposals/commitments that lack offeringId.
 *
 * Never invent an offeringId from serviceScopeCode alone. Ops must supply a
 * verified mapping (by record id and/or legacy serviceScopeCode) before apply.
 */

export type CapacityScopeEntityKind = 'CapacityProposal' | 'CapacityCommitment';

export interface CapacityScopeSnapshot {
  kind: CapacityScopeEntityKind;
  recordId: string;
  vendorId: string;
  communityId: string;
  scope: PackageScope;
  pk: string;
  sk: string;
}

export interface VerifiedOfferingMapping {
  /** Prefer per-record mapping when both are present. */
  recordId?: string;
  serviceScopeCode?: string;
  offeringId: string;
  /** Optional label override; otherwise the existing scope label is kept. */
  label?: string;
  /** Must be true for the mapping to be applied. */
  verified: boolean;
}

export type CapacityScopeRepairAction =
  | 'noop'
  | 'setOfferingId'
  | 'needsManualMapping';

export interface CapacityScopeRepairPlan {
  kind: CapacityScopeEntityKind;
  recordId: string;
  vendorId: string;
  communityId: string;
  action: CapacityScopeRepairAction;
  currentScope: PackageScope;
  nextScope?: PackageScope;
  reason: string;
}

export function classifyCapacityScope(snapshot: CapacityScopeSnapshot): {
  missingOfferingId: boolean;
  hasLegacyServiceScopeCode: boolean;
} {
  return {
    missingOfferingId: !packageScopeOfferingId(snapshot.scope),
    hasLegacyServiceScopeCode: Boolean(snapshot.scope.serviceScopeCode?.trim()),
  };
}

export function planCapacityScopeRepair(
  snapshot: CapacityScopeSnapshot,
  mappings: readonly VerifiedOfferingMapping[],
): CapacityScopeRepairPlan {
  const currentOfferingId = packageScopeOfferingId(snapshot.scope);
  const base = {
    kind: snapshot.kind,
    recordId: snapshot.recordId,
    vendorId: snapshot.vendorId,
    communityId: snapshot.communityId,
    currentScope: snapshot.scope,
  };

  if (currentOfferingId) {
    return {
      ...base,
      action: 'noop',
      reason: 'offeringId already present; leave legacy serviceScopeCode readable until optional cleanup',
    };
  }

  const byRecord = mappings.find(
    (entry) =>
      entry.verified
      && entry.recordId?.trim() === snapshot.recordId
      && isCatalogId(entry.offeringId.trim()),
  );
  const legacyCode = snapshot.scope.serviceScopeCode?.trim();
  const byCode = !byRecord && legacyCode
    ? mappings.find(
      (entry) =>
        entry.verified
        && entry.serviceScopeCode?.trim() === legacyCode
        && isCatalogId(entry.offeringId.trim()),
    )
    : undefined;
  const mapping = byRecord ?? byCode;

  if (!mapping) {
    return {
      ...base,
      action: 'needsManualMapping',
      reason: legacyCode
        ? `No verified offeringId mapping for ${snapshot.kind} ${snapshot.recordId} (serviceScopeCode=${legacyCode})`
        : `No verified offeringId mapping for ${snapshot.kind} ${snapshot.recordId} (no serviceScopeCode either)`,
    };
  }

  const offeringId = mapping.offeringId.trim();
  const label = (mapping.label?.trim() || snapshot.scope.label || '').trim();
  if (!label) {
    throw new ValidationError(
      `Mapped offeringId for ${snapshot.recordId} requires a label`,
    );
  }

  return {
    ...base,
    action: 'setOfferingId',
    nextScope: {
      offeringId,
      label,
      ...(legacyCode ? { serviceScopeCode: legacyCode } : {}),
    },
    reason: byRecord
      ? `Apply verified record mapping to offeringId=${offeringId}`
      : `Apply verified serviceScopeCode mapping to offeringId=${offeringId}`,
  };
}

export function plansNeedingAttention(
  plans: readonly CapacityScopeRepairPlan[],
): CapacityScopeRepairPlan[] {
  return plans.filter((plan) => plan.action !== 'noop');
}
