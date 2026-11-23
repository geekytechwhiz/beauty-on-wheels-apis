import {
  BaseError,
  ConditionalWriteConflictError,
  ValidationError,
} from '@api-hub/utils';

import {
  CAPACITY_HOLDING_STATUSES,
  CAPACITY_RESERVATION_KIND,
  CapacityCommitmentDdbItem,
  claimedPeriodQuantityOf,
  commitmentPeriodSupply,
  isHoldExpired,
  packageScopeOfferingId,
  planReservationConsumesDailySlots,
  reservationKindOf,
  visitFitsDailyWindow,
  windowServesDate,
} from '../domain/capacity-commitment';
import {
  CapacityProposalsRepository,
  getCapacityProposalsRepository,
} from '../repositories/capacity-proposals.repository';

export interface ReservePlanCapacityInput {
  vendorId: string;
  communityId: string;
  offeringId: string;
  /**
   * Plan lifetime visit-slot demand (`planVisitSlotDemand`). Compared to
   * period supply (`quantity * serviceDays`), never to a single day's quantity.
   */
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
  claimedPeriodQuantity?: number;
  periodSupply?: number;
  kind: 'hold' | 'sold';
  expiresAt?: string;
}

export interface ReleasePlanCapacityInput {
  planId: string;
}

export interface ReserveVisitCapacityInput {
  vendorId: string;
  communityId: string;
  offeringId: string;
  planId: string;
  visitId: string;
  date: string;
  startTime: string;
  endTime: string;
  /** Visit slot-units for this occurrence (not plan lifetime demand). */
  demandQuantity: number;
}

export interface ReserveVisitCapacityResult {
  commitmentId: string;
  date: string;
  quantity: number;
  reservedSoldQuantity: number;
  remainingSoldCapacity: number;
}

export interface ReleaseVisitCapacityInput {
  visitId: string;
}

/**
 * SALES CAPACITY — PERIOD ELIGIBILITY + DATED VISIT DEBITS
 * --------------------------------------------------------
 * Units (see capacity-commitment.ts):
 * - Commitment `quantity`: slot-units **per service-window day**
 * - Plan `demandQuantity` at payment: slot-units over the **plan period**
 * - Visit `demandQuantity` at schedule: slot-units for **one occurrence**
 *
 * Lifecycle:
 * 1. holdPlanCapacity at payment initiate — claims period supply
 *    (`claimedPeriodQuantity`), writes plan pointer with consumesDailySlots=false.
 * 2. confirmPlanCapacity at payment success — converts hold→sold; no daily debit.
 * 3. reserveVisitCapacity when a visit gets a date — debits CommitmentDaySold.
 * 4. releaseVisitCapacity on cancel/reschedule-away; releasePlanCapacity on
 *    fail/cancel/expire/refund of the plan (releases period claim).
 *
 * Selection at payment: ACTIVE (etc.) commitment for vendor+community whose
 * scope.offeringId matches and `periodSupply - claimedPeriodQuantity >= demand`.
 * Selection at visit: same filters plus windowServesDate + visitFitsDailyWindow,
 * with day remaining >= visit demand.
 */
export class SoldCapacityService {
  constructor(
    private readonly repository: CapacityProposalsRepository = getCapacityProposalsRepository(),
  ) {}

  /** Temporary checkout hold (period eligibility). Idempotent per planId. */
  async holdPlanCapacity(input: ReservePlanCapacityInput): Promise<ReservePlanCapacityResult> {
    if (!input.expiresAt?.trim()) {
      throw new ValidationError('expiresAt is required for a capacity hold');
    }
    return this.placePeriodClaim({
      ...input,
      kind: CAPACITY_RESERVATION_KIND.HOLD,
      expiresAt: input.expiresAt.trim(),
    });
  }

  /**
   * Converts a valid hold to sold, or places a sold period claim when the hold is
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
          } else {
            throw error;
          }
        }
      }
      await this.releasePlanCapacity({ planId });
    }

    return this.placePeriodClaim({
      ...input,
      kind: CAPACITY_RESERVATION_KIND.SOLD,
      expiresAt: undefined,
    });
  }

  /** Legacy entry used by older booking deploys: durable sold period claim. */
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
        consumesDailySlots: planReservationConsumesDailySlots(reservation),
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

  /** Reserves visit slot-units against the matching commitment service day. */
  async reserveVisitCapacity(input: ReserveVisitCapacityInput): Promise<ReserveVisitCapacityResult> {
    const vendorId = input.vendorId.trim();
    const communityId = input.communityId.trim();
    const offeringId = input.offeringId.trim();
    const planId = input.planId.trim();
    const visitId = input.visitId.trim();
    const date = input.date.trim();
    const startTime = input.startTime.trim();
    const endTime = input.endTime.trim();
    const demandQuantity = input.demandQuantity;

    if (!vendorId || !communityId || !offeringId || !planId || !visitId || !date) {
      throw new ValidationError(
        'vendorId, communityId, offeringId, planId, visitId, and date are required',
      );
    }
    if (!startTime || !endTime) {
      throw new ValidationError('startTime and endTime are required');
    }
    if (!Number.isInteger(demandQuantity) || demandQuantity < 1) {
      throw new ValidationError('demandQuantity must be a positive integer');
    }

    const existing = await this.repository.getVisitSoldCapacityReservation(visitId);
    if (existing) {
      if (
        existing.date === date
        && existing.quantity === demandQuantity
        && existing.vendorId === vendorId
      ) {
        return this.loadVisitResult(existing.vendorId, existing.commitmentId, existing.date, existing.quantity);
      }
      throw new BaseError(
        'Visit already has a sold-capacity reservation for a different occurrence',
        409,
        'CAPACITY_CONFLICT',
      );
    }

    const commitment = await this.selectCommitmentForVisit({
      vendorId,
      communityId,
      offeringId,
      date,
      startTime,
      endTime,
      demandQuantity,
    });
    if (!commitment) {
      throw new BaseError(
        `No accepted capacity commitment has enough remaining visit-slots for this visit`
          + ` (demand=${demandQuantity}, date=${date}, vendor=${vendorId}, community=${communityId}, offering=${offeringId})`,
        409,
        'CAPACITY_UNAVAILABLE',
      );
    }

    try {
      await this.repository.reserveVisitSoldCapacity({
        vendorId,
        commitmentId: commitment.commitmentId,
        commitmentQuantity: commitment.quantity,
        planId,
        visitId,
        date,
        quantity: demandQuantity,
        startTime,
        endTime,
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        const raced = await this.repository.getVisitSoldCapacityReservation(visitId);
        if (
          raced
          && raced.date === date
          && raced.quantity === demandQuantity
          && raced.vendorId === vendorId
        ) {
          return this.loadVisitResult(raced.vendorId, raced.commitmentId, raced.date, raced.quantity);
        }
        throw new BaseError(
          'No accepted capacity commitment has enough remaining visit-slots for this visit',
          409,
          'CAPACITY_UNAVAILABLE',
        );
      }
      throw error;
    }

    return this.loadVisitResult(vendorId, commitment.commitmentId, date, demandQuantity);
  }

  async releaseVisitCapacity(input: ReleaseVisitCapacityInput): Promise<void> {
    const visitId = input.visitId.trim();
    if (!visitId) {
      throw new ValidationError('visitId is required');
    }
    const reservation = await this.repository.getVisitSoldCapacityReservation(visitId);
    if (!reservation) {
      return;
    }
    try {
      await this.repository.releaseVisitSoldCapacity({
        vendorId: reservation.vendorId,
        commitmentId: reservation.commitmentId,
        visitId,
        date: reservation.date,
        quantity: reservation.quantity,
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        const gone = await this.repository.getVisitSoldCapacityReservation(visitId);
        if (!gone) return;
        throw new BaseError(
          'Visit sold capacity release conflict; reload and retry',
          409,
          'CONFLICT',
        );
      }
      throw error;
    }
  }

  private async placePeriodClaim(input: ReservePlanCapacityInput & {
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

    const commitment = await this.selectCommitmentForPeriod({
      vendorId,
      communityId,
      offeringId,
      demandQuantity,
    });
    if (!commitment) {
      throw new BaseError(
        `No accepted capacity commitment has enough remaining period visit-slots for this plan`
          + ` (demand=${demandQuantity}, vendor=${vendorId}, community=${communityId}, offering=${offeringId})`,
        409,
        'CAPACITY_UNAVAILABLE',
      );
    }

    const periodSupply = commitmentPeriodSupply(commitment);
    try {
      await this.repository.reserveSoldCapacity({
        vendorId,
        commitmentId: commitment.commitmentId,
        quantity: demandQuantity,
        commitmentQuantity: commitment.quantity,
        periodSupply,
        idempotencyKey: planId,
        planId,
        kind: input.kind,
        consumesDailySlots: false,
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
        throw new BaseError(
          'No accepted capacity commitment has enough remaining period visit-slots for this plan',
          409,
          'CAPACITY_UNAVAILABLE',
        );
      }
      throw error;
    }

    return this.loadReservationResult(
      vendorId,
      commitment.commitmentId,
      input.kind,
      input.expiresAt,
    );
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

  private async loadVisitResult(
    vendorId: string,
    commitmentId: string,
    date: string,
    quantity: number,
  ): Promise<ReserveVisitCapacityResult> {
    const commitment = await this.repository.getCommitment(vendorId, commitmentId);
    if (!commitment) {
      throw new BaseError('Capacity commitment not found after visit reserve', 500, 'INTERNAL_ERROR');
    }
    const day = await this.repository.getCommitmentDaySold(vendorId, commitmentId, date);
    const reservedSoldQuantity = day?.reservedSoldQuantity ?? quantity;
    return {
      commitmentId,
      date,
      quantity: commitment.quantity,
      reservedSoldQuantity,
      remainingSoldCapacity: commitment.quantity - reservedSoldQuantity,
    };
  }

  private async selectCommitmentForPeriod(input: {
    vendorId: string;
    communityId: string;
    offeringId: string;
    demandQuantity: number;
  }): Promise<CapacityCommitmentDdbItem | null> {
    const commitments = await this.repository.listCommitments(input.vendorId);
    return (
      commitments.find((item) => {
        if (!CAPACITY_HOLDING_STATUSES.includes(item.status)) return false;
        if (item.communityId !== input.communityId) return false;
        if (packageScopeOfferingId(item.scope) !== input.offeringId) return false;
        const periodSupply = commitmentPeriodSupply(item);
        return periodSupply - claimedPeriodQuantityOf(item) >= input.demandQuantity;
      }) ?? null
    );
  }

  private async selectCommitmentForVisit(input: {
    vendorId: string;
    communityId: string;
    offeringId: string;
    date: string;
    startTime: string;
    endTime: string;
    demandQuantity: number;
  }): Promise<CapacityCommitmentDdbItem | null> {
    const commitments = await this.repository.listCommitments(input.vendorId);
    for (const item of commitments) {
      if (!CAPACITY_HOLDING_STATUSES.includes(item.status)) continue;
      if (item.communityId !== input.communityId) continue;
      if (packageScopeOfferingId(item.scope) !== input.offeringId) continue;
      if (!windowServesDate(item.window, input.date)) continue;
      if (!visitFitsDailyWindow(item.window.dailyWindow, input.startTime, input.endTime)) continue;
      if (item.quantity < input.demandQuantity) continue;
      const day = await this.repository.getCommitmentDaySold(
        input.vendorId,
        item.commitmentId,
        input.date,
      );
      const reserved = day?.reservedSoldQuantity ?? 0;
      if (item.quantity - reserved >= input.demandQuantity) {
        return item;
      }
    }
    return null;
  }
}

function toResult(commitment: CapacityCommitmentDdbItem) {
  const periodSupply = commitmentPeriodSupply(commitment);
  const claimed = claimedPeriodQuantityOf(commitment);
  return {
    commitmentId: commitment.commitmentId,
    quantity: commitment.quantity,
    reservedSoldQuantity: commitment.reservedSoldQuantity,
    remainingSoldCapacity: commitment.quantity - commitment.reservedSoldQuantity,
    claimedPeriodQuantity: claimed,
    periodSupply,
  };
}

let service: SoldCapacityService;

export function getSoldCapacityService(): SoldCapacityService {
  if (!service) {
    service = new SoldCapacityService();
  }
  return service;
}
