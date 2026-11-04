import { BaseError } from '@api-hub/utils';

import {
  CAPACITY_HOLDING_STATUSES,
  CapacityCommitmentDdbItem,
  CapacityCommitmentStatus,
} from '../domain/capacity-commitment';
import {
  CapacityProposalsRepository,
  getCapacityProposalsRepository,
} from '../repositories/capacity-proposals.repository';

const COMMITMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface CapacityCommitmentLookupFact {
  commitmentId: string;
  vendorId: string;
  communityId: string;
  status: CapacityCommitmentStatus;
  quantity: number;
  scope: CapacityCommitmentDdbItem['scope'];
  window: CapacityCommitmentDdbItem['window'];
  /** True when status still holds committed supply for sales linkage. */
  holdsCapacity: boolean;
}

/**
 * Internal read for Catalog sales-control enablement.
 * Returns every requested id that exists. Missing ids are omitted so the
 * caller can fail closed with a ConflictError naming the absent commitment.
 */
export class CapacityCommitmentLookupService {
  constructor(
    private readonly repository: CapacityProposalsRepository = getCapacityProposalsRepository(),
  ) {}

  async lookup(commitmentIds: readonly string[]): Promise<CapacityCommitmentLookupFact[]> {
    if (commitmentIds.length < 1 || commitmentIds.length > 25) {
      throw new BaseError(
        'commitmentIds must contain 1 to 25 ids',
        400,
        'VALIDATION_ERROR',
      );
    }
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const value of commitmentIds) {
      if (typeof value !== 'string' || !COMMITMENT_ID.test(value.trim())) {
        throw new BaseError('Invalid commitmentId', 400, 'VALIDATION_ERROR');
      }
      const commitmentId = value.trim();
      if (seen.has(commitmentId)) continue;
      seen.add(commitmentId);
      unique.push(commitmentId);
    }

    const facts: CapacityCommitmentLookupFact[] = [];
    for (const commitmentId of unique) {
      const item = await this.repository.getCommitmentById(commitmentId);
      if (!item) continue;
      facts.push(toFact(item));
    }
    return facts;
  }
}

function toFact(item: CapacityCommitmentDdbItem): CapacityCommitmentLookupFact {
  return {
    commitmentId: item.commitmentId,
    vendorId: item.vendorId,
    communityId: item.communityId,
    status: item.status,
    quantity: item.quantity,
    scope: item.scope,
    window: item.window,
    holdsCapacity: CAPACITY_HOLDING_STATUSES.includes(item.status),
  };
}

let service: CapacityCommitmentLookupService | undefined;

export function getCapacityCommitmentLookupService(): CapacityCommitmentLookupService {
  if (!service) {
    service = new CapacityCommitmentLookupService();
  }
  return service;
}
