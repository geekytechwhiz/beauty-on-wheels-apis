/* eslint-disable mvrx/enforce-platform-logger */
import {
  BaseError,
  ConditionalWriteConflictError,
  ValidationError,
} from '@api-hub/utils';

import {
  CAPACITY_HOLDING_STATUSES,
  CAPACITY_RESERVATION_KIND,
  CapacityCommitmentDdbItem,
  isHoldExpired,
  packageScopeOfferingId,
  reservationKindOf,
} from '../domain/capacity-commitment';
import {
  CapacityProposalsRepository,
  getCapacityProposalsRepository,
} from '../repositories/capacity-proposals.repository';

export interface ReservePlanCapacityInput {
  vendorId: string;
  communityId: string;
  offeringId: string;
  demandQuantity: number;
  planId: string;
  /** Checkout payment id when creating a temporary hold. */
  paymentId?: string;
  /** ISO expiry for holds; required when kind is hold. */
  expiresAt?: string;
  /**
   * hold = unpaid checkout (default for holdPlanCapacity).
   * sold = durable reservation after payment (confirm / legacy reserve).
   */
  kind?: 'hold' | 'sold';
}

export interface ReservePlanCapacityResult {
  commitmentId: string;
  quantity: number;
  reservedSoldQuantity: number;
  remainingSoldCapacity: number;
  kind: 'hold' | 'sold';
  expiresAt?: string;
}

export interface ReleasePlanCapacityInput {
  planId: string;
}

/**
 * SALES CAPACITY HOLD + RESERVATION
 * ---------------------------------
 * Capacity unit: workload slot-units per service-window day (see capacity-commitment.ts).
 *
 * Customer plan demand: booking sends demandQuantity from entitlement durations
 * (ceil(durationMinutes / 30) per visit, minimum 1).
 *
 * Lifecycle:
 * 1. holdPlanCapacity at payment initiate — increments reservedSoldQuantity, kind=hold, expiresAt set.
 * 2. confirmPlanCapacity at payment success — converts hold→sold without changing quantity.
 * 3. releasePlanCapacity on fail/cancel/expire — decrements and deletes the pointer.
 *
 * Late payment after hold expiry: confirm releases the expired hold (if still present),
 * then attempts a fresh sold reserve. CAPACITY_UNAVAILABLE means booking must take the
 * compensation/refund path — Dynamo TTL alone is not used for synchronous release.
 *
 * Selection: ACTIVE (or other capacity-holding) commitment for vendor+community whose
 * scope.offeringId exactly matches the plan offering/package id and that has
 * `quantity - reservedSoldQuantity >= demandQuantity`. Commitments missing offeringId
 * (legacy serviceScopeCode-only rows) are never treated as unrestricted capacity.
 */
export class SoldCapacityService {
  constructor(
    private readonly repository: CapacityProposalsRepository = getCapacityProposalsRepository(),
  ) {}

  /** Temporary checkout hold. Idempotent per planId. */
  async holdPlanCapacity(input: ReservePlanCapacityInput): Promise<ReservePlanCapacityResult> {
    if (!input.expiresAt.trim()) {
      throw new ValidationError('expiresAt is required for a capacity hold');
    }
    return this.placeReservation({
      ...input,
      kind: CAPACITY_RESERVATION_KIND.HOLD,
      expiresAt: input.expiresAt.trim(),
    });
  }

  /**
   * Converts a valid hold to sold, or places a sold reservation when the hold is
   * missing/expired (reacquire). Idempotent when already sold.
   */
  async confirmPlanCapacity(input: ReservePlanCapacityInput): Promise<ReservePlanCapacityResult> {
    const planId = input.planId.trim();
    const existing = await this.repository.getSoldCapacityReservation(planId);
    if (existing) {
      if (existing.vendorId !== input.vendorId.trim()) {
        throw new BaseError('Plan reservation belongs to another vendor', 409, 'CAPACITY_UNAVAILABLE');
      }
      if (reservationKindOf(existing) === CAPACITY_RESERVATION_KIND.SOLD) {
        return this.loadReservationResult(existing.vendorId, existing.commitmentId, CAPACITY_RESERVATION_KIND.SOLD);
      }
      if (!isHoldExpired(existing)) {
        try {
          await this.repository.confirmCapacityHold({
            planId,
            expectedCommitmentId: existing.commitmentId,
            expectedQuantity: existing.quantity,
          });
          return this.loadReservationResult(
            existing.vendorId,
            existing.commitmentId,
            CAPACITY_RESERVATION_KIND.SOLD,
          );
        } catch (error) {
          if (error instanceof ConditionalWriteConflictError) {
            const raced = await this.repository.getSoldCapacityReservation(planId);
            if (raced && reservationKindOf(raced) === CAPACITY_RESERVATION_KIND.SOLD) {
              return this.loadReservationResult(
                raced.vendorId,
                raced.commitmentId,
                CAPACITY_RESERVATION_KIND.SOLD,
              );
            }
            // Hold expired between read and write — fall through to reacquire.
          } else {
            throw error;
          }
        }
      }
      // Expired (or confirm raced to expiry): release synchronously, then reacquire as sold.
      await this.releasePlanCapacity({ planId });
    }

    return this.placeReservation({
      ...input,
      kind: CAPACITY_RESERVATION_KIND.SOLD,
      expiresAt: undefined,
    });
  }

  /**
   * Legacy entry used by older booking deploys: durable sold reserve.
   * Prefer hold + confirm from current booking-service.
   */
  async reservePlanCapacity(input: ReservePlanCapacityInput): Promise<ReservePlanCapacityResult> {
    return this.confirmPlanCapacity(input);
  }

  async releasePlanCapacity(input: ReleasePlanCapacityInput): Promise<void> {
    const planId = input.planId.trim();
    if (!planId) {
      throw new ValidationError('planId is required');
    }
    const reservation = await this.repository.getSoldCapacityReservation(planId);
    if (!reservation) {
      return;
    }
    try {
      await this.repository.releaseSoldCapacity({
        vendorId: reservation.vendorId,
        commitmentId: reservation.commitmentId,
        quantity: reservation.quantity,
        planId,
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        const gone = await this.repository.getSoldCapacityReservation(planId);
        if (!gone) return;
        throw new BaseError(
          'Sold capacity release conflict; reload and retry',
          409,
          'CONFLICT',
        );
      }
      throw error;
    }
  }

  private async placeReservation(input: ReservePlanCapacityInput & {
    kind: 'hold' | 'sold';
  }): Promise<ReservePlanCapacityResult> {
    const vendorId = input.vendorId.trim();
    const communityId = input.communityId.trim();
    const offeringId = input.offeringId.trim();
    const planId = input.planId.trim();
    const demandQuantity = input.demandQuantity;
    if (!vendorId || !communityId || !offeringId || !planId) {
      throw new ValidationError('vendorId, communityId, offeringId, and planId are required');
    }
    if (!Number.isInteger(demandQuantity) || demandQuantity < 1) {
      throw new ValidationError('demandQuantity must be a positive integer');
    }

    const existing = await this.repository.getSoldCapacityReservation(planId);
    if (existing) {
      if (existing.vendorId !== vendorId) {
        throw new BaseError('Plan reservation belongs to another vendor', 409, 'CAPACITY_UNAVAILABLE');
      }
      if (
        input.kind === CAPACITY_RESERVATION_KIND.HOLD
        && reservationKindOf(existing) === CAPACITY_RESERVATION_KIND.HOLD
        && isHoldExpired(existing)
      ) {
        await this.releasePlanCapacity({ planId });
      } else {
        return this.loadReservationResult(
          existing.vendorId,
          existing.commitmentId,
          reservationKindOf(existing),
          existing.expiresAt,
        );
      }
    }

    const commitment = await this.selectCommitment({
      vendorId,
      communityId,
      offeringId,
      demandQuantity,
    });
    // eslint-disable-next-line no-console
    console.log('commitment2', vendorId, communityId, offeringId, demandQuantity, commitment);
    if (!commitment) {
      throw new BaseError(
        'No accepted capacity commitment has enough remaining visit-slots for this plan',
        409,
        'CAPACITY_UNAVAILABLE',
      );
    }

    try {
      await this.repository.reserveSoldCapacity({
        vendorId,
        commitmentId: commitment.commitmentId,
        quantity: demandQuantity,
        idempotencyKey: planId,
        planId,
        kind: input.kind,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        ...(input.paymentId?.trim() ? { paymentId: input.paymentId.trim() } : {}),
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        const raced = await this.repository.getSoldCapacityReservation(planId);
        if (raced) {
          return this.loadReservationResult(
            raced.vendorId,
            raced.commitmentId,
            reservationKindOf(raced),
            raced.expiresAt,
          );
        }
        // throw new BaseError(
        //   'No accepted capacity commitment has enough remaining visit-slots for this plan',
        //   409,
        //   'CAPACITY_UNAVAILABLE',
        // );
      }
      throw error;
    }

    const updated = await this.repository.getCommitment(vendorId, commitment.commitmentId);
    if (!updated) {
      throw new BaseError('Capacity commitment not found after reserve', 500, 'INTERNAL_ERROR');
    }
    return {
      ...toResult(updated),
      kind: input.kind,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    };
  }

  private async loadReservationResult(
    vendorId: string,
    commitmentId: string,
    kind: 'hold' | 'sold',
    expiresAt?: string,
  ): Promise<ReservePlanCapacityResult> {
    const commitment = await this.repository.getCommitment(vendorId, commitmentId);
    if (!commitment) {
      throw new BaseError('Capacity commitment not found for existing reservation', 500, 'INTERNAL_ERROR');
    }
    return {
      ...toResult(commitment),
      kind,
      ...(expiresAt ? { expiresAt } : {}),
    };
  }

  private async selectCommitment(input: {
    vendorId: string;
    communityId: string;
    offeringId: string;
    demandQuantity: number;
  }): Promise<CapacityCommitmentDdbItem | null> {
    const commitments = await this.repository.listCommitments(input.vendorId);
    console.log('commitments', commitments);
    return (
      commitments.find(
        (item) =>
          CAPACITY_HOLDING_STATUSES.includes(item.status)
          && item.communityId === input.communityId
          // && packageScopeOfferingId(item.scope) === input.offeringId
          && remainingVisitSlots(item) >= input.demandQuantity,
      ) ?? null
    );
  }
}

function remainingVisitSlots(commitment: CapacityCommitmentDdbItem): number {
  return commitment.quantity - commitment.reservedSoldQuantity;
}

function toResult(commitment: CapacityCommitmentDdbItem) {
  return {
    commitmentId: commitment.commitmentId,
    quantity: commitment.quantity,
    reservedSoldQuantity: commitment.reservedSoldQuantity,
    remainingSoldCapacity: remainingVisitSlots(commitment),
  };
}

let service: SoldCapacityService;

export function getSoldCapacityService(): SoldCapacityService {
  if (!service) {
    service = new SoldCapacityService();
  }
  return service;
}
