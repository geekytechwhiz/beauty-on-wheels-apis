import { ConditionalWriteConflictError, NotFoundError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { requirePathId } from '../auth/access';
import { toAllocationSummary } from '../domain/view';
import { AvailabilityErrors } from '../errors';
import {
  AllocationsRepository,
  getAllocationsRepository,
} from '../repositories/allocations.repository';
import { getSlotsRepository, SlotsRepository } from '../repositories/slots.repository';
import { HoldsService, getHoldsService } from './holds.service';

const baseLogger = createLogger({
  service: 'allocations-service',
  redactPII: true,
});

export class AllocationsService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'AllocationsService',
  });

  constructor(
    private readonly allocations: AllocationsRepository = getAllocationsRepository(),
    private readonly slots: SlotsRepository = getSlotsRepository(),
    private readonly holds: HoldsService = getHoldsService(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async consumeHold(input: { holdId?: string; bookingId?: string }) {
    if (!input.holdId || !input.bookingId) {
      throw new NotFoundError('holdId and bookingId are required');
    }
    return this.holds.consume({
      holdId: input.holdId,
      bookingId: input.bookingId,
    });
  }

  async releaseByBooking(input: { bookingId?: string }) {
    const bookingId = requirePathId(input.bookingId ?? '', 'bookingId');
    const lookup = await this.allocations.getByBookingId(bookingId);
    if (!lookup) {
      throw new NotFoundError('Allocation not found');
    }
    if (lookup.status === 'released') {
      return toAllocationSummary(lookup);
    }
    const allocation = await this.allocations.getCanonical(
      lookup.canonicalPk,
      lookup.canonicalSk,
    );
    if (!allocation) {
      throw new NotFoundError('Allocation not found');
    }
    const slotLookup = await this.slots.getSlotLookup(allocation.slotId);
    if (!slotLookup) {
      throw AvailabilityErrors.slotNotFound();
    }
    try {
      await this.allocations.releaseAllocation({
        allocation,
        lookup,
        slotKey: { PK: slotLookup.canonicalPk, SK: slotLookup.canonicalSk },
        now: this.now().toISOString(),
      });
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError)) {
        throw error;
      }
      const current = await this.allocations.getByBookingId(bookingId);
      if (current?.status === 'released') {
        return toAllocationSummary(current);
      }
      throw error;
    }
    this.logger.info({
      event: 'allocation_released',
      bookingId,
      slotId: allocation.slotId,
    });
    return toAllocationSummary({ ...allocation, status: 'released' });
  }

  async findByBooking(bookingId: string) {
    const lookup = await this.allocations.getByBookingId(requirePathId(bookingId, 'bookingId'));
    if (!lookup) {
      return null;
    }
    return toAllocationSummary(lookup);
  }
}

let service: AllocationsService;

export function getAllocationsService(): AllocationsService {
  if (!service) {
    service = new AllocationsService();
  }
  return service;
}
