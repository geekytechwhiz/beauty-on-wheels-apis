/**
 * Hierarchical keys on the existing availability table.
 * Inventory is partitioned by vendor, branch, and business-local date.
 * Community visit occurrences reuse vendor PK partitions and project onto GSI1
 * under COMMUNITY#… for community/date-range browse.
 * GSI1 is shared by namespaces (hold expiry, customer holds, community visits).
 */

export const AvailabilityKeyBuilder = {
  communityPk(communityId: string): string {
    return `COMMUNITY#${communityId}`;
  },

  communityVisitSk(date: string, vendorId: string, visitId: string): string {
    return `CVISIT#${date}#${vendorId}#${visitId}`;
  },

  communityVisitSkFrom(date: string): string {
    return `CVISIT#${date}`;
  },

  communityScheduleSk(vendorId: string, scheduleId: string): string {
    return `CVISIT_SCHEDULE#${vendorId}#${scheduleId}`;
  },

  vendorCommunityVisitPk(vendorId: string): string {
    return `VENDOR#${vendorId}`;
  },

  vendorCommunityVisitSk(date: string, visitId: string): string {
    return `CVISIT#${date}#${visitId}`;
  },

  vendorCommunityVisitSkFrom(date: string): string {
    return `CVISIT#${date}`;
  },

  vendorCommunityScheduleSk(scheduleId: string): string {
    return `CVISIT_SCHEDULE#${scheduleId}`;
  },

  communityVisitHoldSk(visitId: string, holdId: string): string {
    return `CVISIT_HOLD#${visitId}#${holdId}`;
  },

  dailyPk(vendorId: string, branchId: string, date: string): string {
    return `VENDOR#${vendorId}#BRANCH#${branchId}#DATE#${date}`;
  },

  slotSk(startTime: string, slotId: string): string {
    return `SLOT#${startTime}#${slotId}`;
  },

  slotLookupPk(slotId: string): string {
    return `SLOT#${slotId}`;
  },

  holdSk(slotId: string, holdId: string): string {
    return `HOLD#${slotId}#${holdId}`;
  },

  holdLookupPk(holdId: string): string {
    return `HOLD#${holdId}`;
  },

  allocationSk(slotId: string, bookingId: string): string {
    return `ALLOCATION#${slotId}#${bookingId}`;
  },

  allocationLookupPk(bookingId: string): string {
    return `BOOKING#${bookingId}`;
  },

  allocationLookupSk(): string {
    return 'ALLOCATION';
  },

  idempotencyPk(customerId: string, idempotencyKey: string): string {
    return `IDEMPOTENCY#HOLD#${customerId}#${idempotencyKey}`;
  },

  schedulePk(vendorId: string, branchId: string): string {
    return `VENDOR#${vendorId}#BRANCH#${branchId}#SCHEDULE`;
  },

  scheduleSk(): string {
    return 'HOURS';
  },

  scheduleIndexPk(vendorId: string): string {
    return `VENDOR#${vendorId}#SCHEDULES`;
  },

  scheduleIndexSk(branchId: string): string {
    return `BRANCH#${branchId}`;
  },

  branchHolidayPk(vendorId: string, branchId: string): string {
    return `VENDOR#${vendorId}#BRANCH#${branchId}#HOLIDAYS`;
  },

  vendorHolidayPk(vendorId: string): string {
    return `VENDOR#${vendorId}#HOLIDAYS`;
  },

  holidaySk(date: string, holidayId: string): string {
    return `HOLIDAY#${date}#${holidayId}`;
  },

  holidayLookupPk(holidayId: string): string {
    return `HOLIDAY#${holidayId}`;
  },

  holidayIndexPk(vendorId: string): string {
    return `VENDOR#${vendorId}#HOLIDAY_INDEX`;
  },

  holidayIndexSk(date: string, holidayId: string): string {
    return `HOLIDAY#${date}#${holidayId}`;
  },

  /** Hour bucket for active holds. Example: HOLD_EXPIRY#2026-10-12T11 */
  holdExpiryPk(hourBucket: string): string {
    return `HOLD_EXPIRY#${hourBucket}`;
  },

  holdExpirySk(expiresAt: string, holdId: string): string {
    return `HOLD#${expiresAt}#${holdId}`;
  },

  customerHoldPk(customerId: string): string {
    return `CUSTOMER#${customerId}`;
  },

  customerHoldSk(createdAt: string, holdId: string): string {
    return `HOLD#${createdAt}#${holdId}`;
  },

  slotSkFrom(startTime: string): string {
    return `SLOT#${startTime}`;
  },

  holdPrefix(slotId?: string): string {
    return slotId ? `HOLD#${slotId}#` : 'HOLD#';
  },

  allocationPrefix(slotId?: string): string {
    return slotId ? `ALLOCATION#${slotId}#` : 'ALLOCATION#';
  },
};
